from __future__ import annotations

import os
import json
import secrets
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Iterator
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from relevo.config import AppConfig, GoogleOAuthConfig
from relevo.db import (
    add_existing_account_to_project,
    connect,
    consume_desktop_login_exchange,
    consume_oauth_login_state,
    create_account_session,
    create_desktop_login_exchange,
    create_oauth_login_state,
    create_project_for_account,
    delete_project_by_id,
    get_account,
    get_account_by_email,
    get_account_by_session_token,
    get_project,
    get_project_membership_for_account,
    get_project_memberships_for_account,
    get_user_by_token,
    remove_project_membership_for_account,
    revoke_account_session,
    SESSION_TOKEN_PREFIX,
    token_hash,
    upsert_account_from_google,
)

router = APIRouter()

TRUE_VALUES = {"1", "true", "yes", "y", "on"}
DEFAULT_DEMO_ADMIN_EMAIL = "sbarronbucolo@udesa.edu.ar"
DEFAULT_DEMO_ADMIN_PASSWORD = "123"
DEFAULT_DEMO_ADMIN_SESSION_TOKEN = "123"


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in TRUE_VALUES


class AccountOut(BaseModel):
    id: UUID
    email: str
    display_name: str
    avatar_url: str | None = None
    email_verified: bool


class ProjectMembershipOut(BaseModel):
    project_id: UUID
    project_name: str
    description: str | None = None
    user_id: UUID
    display_name: str
    domain_summary: str
    role: str


class AuthStateResponse(BaseModel):
    account: AccountOut
    projects: list[ProjectMembershipOut]


class DesktopExchangeRequest(BaseModel):
    code: str = Field(min_length=1)


class DesktopExchangeResponse(AuthStateResponse):
    session_token: str


class DemoLoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    domain_summary: str | None = None


class AddProjectMemberRequest(BaseModel):
    email: str = Field(min_length=3)
    domain_summary: str = Field(min_length=1)


def get_db() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        yield conn


def _extract_token(
    authorization: str | None,
    x_user_token: str | None,
    x_auth_token: str | None,
) -> str | None:
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
        if authorization.strip():
            return authorization.strip()
    return x_user_token or x_auth_token


def _account_out(account: dict[str, Any]) -> AccountOut:
    return AccountOut(
        id=account["id"],
        email=account["email"],
        display_name=account["display_name"],
        avatar_url=account.get("avatar_url"),
        email_verified=bool(account.get("email_verified")),
    )


def _auth_state(conn: psycopg.Connection, account: dict[str, Any]) -> AuthStateResponse:
    return AuthStateResponse(
        account=_account_out(account),
        projects=[
            ProjectMembershipOut(**project)
            for project in get_project_memberships_for_account(conn, account["id"])
        ],
    )


def _ensure_demo_session(
    conn: psycopg.Connection,
    account_id: UUID,
    token: str,
    *,
    ttl_seconds: int,
) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO account_session (account_id, token_hash, expires_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (token_hash)
            DO UPDATE SET
              account_id = EXCLUDED.account_id,
              expires_at = EXCLUDED.expires_at,
              revoked_at = NULL
            """,
            (account_id, token_hash(token), expires_at),
        )
        conn.commit()


def require_auth(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
    x_user_token: Annotated[str | None, Header(alias="X-User-Token")] = None,
    x_auth_token: Annotated[str | None, Header(alias="X-Auth-Token")] = None,
) -> dict[str, Any]:
    token = _extract_token(authorization, x_user_token, x_auth_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    if token.startswith(SESSION_TOKEN_PREFIX):
        account = get_account_by_session_token(conn, token)
        if account is not None:
            return {"kind": "session", "account": account, "token": token}

        user = get_user_by_token(conn, token)
        if user is not None:
            return {"kind": "legacy", "user": user, "token": token}
    else:
        user = get_user_by_token(conn, token)
        if user is not None:
            return {"kind": "legacy", "user": user, "token": token}

        account = get_account_by_session_token(conn, token)
        if account is not None:
            return {"kind": "session", "account": account, "token": token}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid bearer token",
    )


def require_account(auth: Annotated[dict[str, Any], Depends(require_auth)]) -> dict[str, Any]:
    if auth["kind"] != "session":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account session is required",
        )
    return auth["account"]


def require_project_membership(
    conn: psycopg.Connection,
    auth: dict[str, Any],
    project_id: UUID | None,
) -> dict[str, Any]:
    if auth["kind"] == "legacy":
        user = auth["user"]
        if project_id is not None and project_id != user["project_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authenticated user is not a member of this project",
            )
        return user

    if project_id is None:
        raise HTTPException(status_code=422, detail="project_id or X-Project-Id is required")

    membership = get_project_membership_for_account(
        conn,
        account_id=auth["account"]["id"],
        project_id=project_id,
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated account is not a member of this project",
        )
    return membership


def require_project_leader(
    conn: psycopg.Connection,
    account: dict[str, Any],
    project_id: UUID,
) -> dict[str, Any]:
    membership = get_project_membership_for_account(
        conn,
        account_id=account["id"],
        project_id=project_id,
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated account is not a member of this project",
        )
    if membership["role"] != "leader":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project leader role is required",
        )
    return membership


def _oauth_config(request: Request) -> GoogleOAuthConfig:
    config: AppConfig = request.app.state.config
    return config.google_oauth


def _google_redirect_uri(request: Request, config: GoogleOAuthConfig) -> str:
    return config.redirect_uri or str(request.url_for("google_oauth_callback"))


def _ensure_google_config(config: GoogleOAuthConfig) -> None:
    if not config.client_id or not config.client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured",
        )


def _exchange_google_code(
    *,
    code: str,
    redirect_uri: str,
    config: GoogleOAuthConfig,
) -> dict[str, Any]:
    _ensure_google_config(config)
    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        config.token_url,
        data=body,
        headers={"content-type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_google_userinfo(*, access_token: str, config: GoogleOAuthConfig) -> dict[str, Any]:
    request = urllib.request.Request(
        config.userinfo_url,
        headers={"authorization": f"Bearer {access_token}"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


@router.get("/auth/google/start")
def google_oauth_start(
    request: Request,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    desktop_redirect_uri: Annotated[str, Query(min_length=1)],
) -> RedirectResponse:
    if not desktop_redirect_uri.startswith("relevo://"):
        raise HTTPException(status_code=422, detail="desktop_redirect_uri must use relevo://")

    config = _oauth_config(request)
    _ensure_google_config(config)
    google_redirect_uri = _google_redirect_uri(request, config)
    state = secrets.token_urlsafe(32)
    create_oauth_login_state(
        conn,
        state=state,
        desktop_redirect_uri=desktop_redirect_uri,
        google_redirect_uri=google_redirect_uri,
        ttl_seconds=config.state_ttl_seconds,
    )
    auth_params = {
        "client_id": config.client_id,
        "redirect_uri": google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    }
    auth_url = f"{config.auth_url}?{urllib.parse.urlencode(auth_params)}"
    return RedirectResponse(auth_url)


@router.get("/auth/google/callback", name="google_oauth_callback")
def google_oauth_callback(
    request: Request,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    state: Annotated[str, Query(min_length=1)],
    code: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    state_row = consume_oauth_login_state(conn, state)
    if state_row is None:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    desktop_redirect_uri = state_row["desktop_redirect_uri"]
    if error:
        return RedirectResponse(f"{desktop_redirect_uri}?error={urllib.parse.quote(error)}")
    if not code:
        return RedirectResponse(f"{desktop_redirect_uri}?error=missing_code")

    config = _oauth_config(request)
    try:
        token_payload = _exchange_google_code(
            code=code,
            redirect_uri=state_row["google_redirect_uri"],
            config=config,
        )
        access_token = token_payload["access_token"]
        userinfo = _fetch_google_userinfo(access_token=access_token, config=config)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Google OAuth exchange failed: {exc}") from exc

    account = upsert_account_from_google(
        conn,
        google_sub=str(userinfo["sub"]),
        email=str(userinfo["email"]),
        display_name=str(userinfo.get("name") or userinfo["email"]),
        avatar_url=userinfo.get("picture"),
        email_verified=bool(userinfo.get("email_verified")),
    )
    exchange_code = create_desktop_login_exchange(
        conn,
        account_id=account["id"],
        ttl_seconds=config.exchange_code_ttl_seconds,
    )
    return RedirectResponse(f"{desktop_redirect_uri}?code={urllib.parse.quote(exchange_code)}")


@router.post("/auth/desktop/exchange", response_model=DesktopExchangeResponse)
def exchange_desktop_login(
    body: DesktopExchangeRequest,
    request: Request,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
) -> DesktopExchangeResponse:
    exchange = consume_desktop_login_exchange(conn, body.code)
    if exchange is None:
        raise HTTPException(status_code=400, detail="Invalid or expired login code")
    account = get_account(conn, exchange["account_id"])
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    config = _oauth_config(request)
    session_token = create_account_session(
        conn,
        account["id"],
        ttl_seconds=config.session_ttl_seconds,
    )
    auth_state = _auth_state(conn, account)
    return DesktopExchangeResponse(
        session_token=session_token,
        account=auth_state.account,
        projects=auth_state.projects,
    )


@router.post("/auth/demo/login", response_model=DesktopExchangeResponse)
def demo_login(
    body: DemoLoginRequest,
    request: Request,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
) -> DesktopExchangeResponse:
    if not env_flag("DEMO_PASSWORD_LOGIN"):
        raise HTTPException(status_code=404, detail="Demo password login is not enabled")

    expected_email = os.environ.get("DEMO_ADMIN_EMAIL", DEFAULT_DEMO_ADMIN_EMAIL).strip().lower()
    expected_password = os.environ.get("DEMO_ADMIN_PASSWORD", DEFAULT_DEMO_ADMIN_PASSWORD)
    if body.email.strip().lower() != expected_email or body.password != expected_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid demo credentials")

    account = get_account_by_email(conn, expected_email)
    if account is None:
        raise HTTPException(status_code=404, detail="Demo admin account not found")

    config = _oauth_config(request)
    session_token = os.environ.get(
        "DEMO_ADMIN_SESSION_TOKEN",
        DEFAULT_DEMO_ADMIN_SESSION_TOKEN,
    )
    _ensure_demo_session(
        conn,
        account["id"],
        session_token,
        ttl_seconds=config.session_ttl_seconds,
    )
    auth_state = _auth_state(conn, account)
    return DesktopExchangeResponse(
        session_token=session_token,
        account=auth_state.account,
        projects=auth_state.projects,
    )


@router.post("/auth/logout")
def logout(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    auth: Annotated[dict[str, Any], Depends(require_auth)],
) -> dict[str, str]:
    if auth["kind"] == "session":
        revoke_account_session(conn, auth["token"])
    return {"status": "ok"}


@router.get("/me/projects", response_model=AuthStateResponse)
def list_my_projects(
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    account: Annotated[dict[str, Any], Depends(require_account)],
) -> AuthStateResponse:
    return _auth_state(conn, account)


@router.post("/projects", response_model=ProjectMembershipOut)
def create_project(
    body: CreateProjectRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    account: Annotated[dict[str, Any], Depends(require_account)],
) -> ProjectMembershipOut:
    domain_summary = body.domain_summary or "Project leader and local app user."
    membership = create_project_for_account(
        conn,
        account_id=account["id"],
        name=body.name.strip(),
        description=body.description,
        domain_summary=domain_summary,
    )
    return ProjectMembershipOut(**membership)


@router.post("/projects/{project_id}/members", response_model=ProjectMembershipOut)
def add_project_member(
    project_id: UUID,
    body: AddProjectMemberRequest,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    account: Annotated[dict[str, Any], Depends(require_account)],
) -> ProjectMembershipOut:
    require_project_leader(conn, account, project_id)
    project = get_project(conn, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    target_account = get_account_by_email(conn, body.email)
    if target_account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    try:
        membership = add_existing_account_to_project(
            conn,
            project_id=project_id,
            account_id=target_account["id"],
            domain_summary=body.domain_summary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ProjectMembershipOut(**membership)


@router.delete("/projects/{project_id}", response_model=AuthStateResponse)
def delete_project(
    project_id: UUID,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    account: Annotated[dict[str, Any], Depends(require_account)],
) -> AuthStateResponse:
    require_project_leader(conn, account, project_id)
    if not delete_project_by_id(conn, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return _auth_state(conn, account)


@router.delete("/projects/{project_id}/membership", response_model=AuthStateResponse)
def leave_project(
    project_id: UUID,
    conn: Annotated[psycopg.Connection, Depends(get_db)],
    account: Annotated[dict[str, Any], Depends(require_account)],
) -> AuthStateResponse:
    membership = get_project_membership_for_account(
        conn,
        account_id=account["id"],
        project_id=project_id,
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Project membership not found")
    if membership["role"] == "leader":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project leaders must delete the project instead of leaving it",
        )
    if not remove_project_membership_for_account(
        conn,
        account_id=account["id"],
        project_id=project_id,
    ):
        raise HTTPException(status_code=404, detail="Project membership not found")
    return _auth_state(conn, account)
