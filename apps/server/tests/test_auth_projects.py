from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID


REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from relevo.api import auth as auth_api  # noqa: E402
from relevo.config import AppConfig, GoogleOAuthConfig  # noqa: E402
from relevo.db import token_hash  # noqa: E402
from relevo.main import create_app  # noqa: E402


ACCOUNT_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
PROJECT_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
USER_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")


def account() -> dict:
    return {
        "id": ACCOUNT_ID,
        "google_sub": "google-sub",
        "email": "user@example.com",
        "email_normalized": "user@example.com",
        "display_name": "User Example",
        "avatar_url": None,
        "email_verified": True,
    }


def membership(role: str = "leader") -> dict:
    return {
        "project_id": PROJECT_ID,
        "project_name": "Demo Project",
        "description": "Demo",
        "user_id": USER_ID,
        "display_name": "User Example",
        "domain_summary": "Owns the demo.",
        "role": role,
    }


class AuthProjectsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(
            AppConfig(
                sha="test",
                google_oauth=GoogleOAuthConfig(
                    client_id="google-client",
                    client_secret="google-secret",
                    redirect_uri="https://server.test/auth/google/callback",
                ),
            )
        )
        self.app.dependency_overrides[auth_api.get_db] = lambda: SimpleNamespace()
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_google_callback_creates_desktop_exchange_redirect(self) -> None:
        with (
            patch.object(
                auth_api,
                "consume_oauth_login_state",
                Mock(
                    return_value={
                        "desktop_redirect_uri": "relevo://auth/callback",
                        "google_redirect_uri": "https://server.test/auth/google/callback",
                    }
                ),
            ),
            patch.object(
                auth_api,
                "_exchange_google_code",
                Mock(return_value={"access_token": "google-access-token"}),
            ),
            patch.object(
                auth_api,
                "_fetch_google_userinfo",
                Mock(
                    return_value={
                        "sub": "google-sub",
                        "email": "user@example.com",
                        "name": "User Example",
                        "picture": None,
                        "email_verified": True,
                    }
                ),
            ),
            patch.object(auth_api, "upsert_account_from_google", Mock(return_value=account())),
            patch.object(auth_api, "create_desktop_login_exchange", Mock(return_value="desktop-code")),
        ):
            response = self.client.get(
                "/auth/google/callback?state=state-1&code=google-code",
                follow_redirects=False,
            )

        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "relevo://auth/callback?code=desktop-code")

    def test_desktop_exchange_returns_session_and_projects(self) -> None:
        with (
            patch.object(
                auth_api,
                "consume_desktop_login_exchange",
                Mock(return_value={"account_id": ACCOUNT_ID}),
            ),
            patch.object(auth_api, "get_account", Mock(return_value=account())),
            patch.object(auth_api, "create_account_session", Mock(return_value="rlv_session")),
            patch.object(
                auth_api,
                "get_project_memberships_for_account",
                Mock(return_value=[membership()]),
            ),
        ):
            response = self.client.post("/auth/desktop/exchange", json={"code": "desktop-code"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_token"], "rlv_session")
        self.assertEqual(payload["account"]["email"], "user@example.com")
        self.assertEqual(payload["projects"][0]["project_id"], str(PROJECT_ID))

    def test_session_token_hash_does_not_store_raw_token(self) -> None:
        raw = "rlv_secret"
        self.assertNotEqual(token_hash(raw), raw)
        self.assertEqual(token_hash(raw), token_hash(raw))

    def test_legacy_auth_token_skips_session_lookup_when_user_matches(self) -> None:
        legacy_user = {
            "id": USER_ID,
            "project_id": PROJECT_ID,
            "display_name": "User Example",
            "domain_summary": "Owns the demo.",
            "profile": {},
            "role": "member",
            "account_id": None,
        }
        with (
            patch.dict("os.environ", {"ALLOW_LEGACY_AUTH_TOKENS": "1"}),
            patch.object(auth_api, "get_user_by_token", Mock(return_value=legacy_user)) as get_user,
            patch.object(auth_api, "get_account_by_session_token", Mock()) as get_account_by_session,
        ):
            auth = auth_api.require_auth(SimpleNamespace(), authorization="Bearer dev-token-user1")

        self.assertEqual(auth["kind"], "legacy")
        get_user.assert_called_once_with(unittest.mock.ANY, "dev-token-user1")
        get_account_by_session.assert_not_called()

    def test_legacy_auth_token_is_rejected_by_default(self) -> None:
        with (
            patch.dict("os.environ", {}, clear=True),
            patch.object(auth_api, "get_user_by_token", Mock()) as get_user,
            patch.object(auth_api, "get_account_by_session_token", Mock(return_value=None)) as get_session,
        ):
            with self.assertRaises(HTTPException) as raised:
                auth_api.require_auth(SimpleNamespace(), authorization="Bearer dev-token-user1")

        self.assertEqual(raised.exception.status_code, 401)
        get_user.assert_not_called()
        get_session.assert_called_once_with(unittest.mock.ANY, "dev-token-user1")

    def test_session_auth_token_prefers_session_lookup(self) -> None:
        with (
            patch.object(auth_api, "get_account_by_session_token", Mock(return_value=account())) as get_session,
            patch.object(auth_api, "get_user_by_token", Mock()) as get_user,
        ):
            auth = auth_api.require_auth(SimpleNamespace(), authorization="Bearer rlv_session")

        self.assertEqual(auth["kind"], "session")
        get_session.assert_called_once_with(unittest.mock.ANY, "rlv_session")
        get_user.assert_not_called()

    def test_create_project_creates_leader_membership(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        create = Mock(return_value=membership(role="leader"))
        with patch.object(auth_api, "create_project_for_account", create):
            response = self.client.post(
                "/projects",
                json={"name": "Demo Project", "domain_summary": "Owns the demo."},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "leader")
        create.assert_called_once()

    def test_leader_can_add_existing_user(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        with (
            patch.object(auth_api, "require_project_leader", Mock(return_value=membership())),
            patch.object(auth_api, "get_project", Mock(return_value={"id": PROJECT_ID, "name": "Demo"})),
            patch.object(auth_api, "get_account_by_email", Mock(return_value=account())),
            patch.object(auth_api, "add_existing_account_to_project", Mock(return_value=membership(role="member"))),
        ):
            response = self.client.post(
                f"/projects/{PROJECT_ID}/members",
                json={"email": "user@example.com", "domain_summary": "Frontend."},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "member")

    def test_add_unknown_user_returns_404(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        with (
            patch.object(auth_api, "require_project_leader", Mock(return_value=membership())),
            patch.object(auth_api, "get_project", Mock(return_value={"id": PROJECT_ID, "name": "Demo"})),
            patch.object(auth_api, "get_account_by_email", Mock(return_value=None)),
        ):
            response = self.client.post(
                f"/projects/{PROJECT_ID}/members",
                json={"email": "missing@example.com", "domain_summary": "Frontend."},
            )

        self.assertEqual(response.status_code, 404)

    def test_member_cannot_add_users(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        with patch.object(
            auth_api,
            "require_project_leader",
            Mock(side_effect=HTTPException(status_code=403, detail="Project leader role is required")),
        ):
            response = self.client.post(
                f"/projects/{PROJECT_ID}/members",
                json={"email": "user@example.com", "domain_summary": "Frontend."},
            )

        self.assertEqual(response.status_code, 403)

    def test_leader_can_delete_project(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        delete_project = Mock(return_value=True)
        with (
            patch.object(auth_api, "require_project_leader", Mock(return_value=membership())),
            patch.object(auth_api, "delete_project_by_id", delete_project),
            patch.object(auth_api, "get_project_memberships_for_account", Mock(return_value=[])),
        ):
            response = self.client.delete(f"/projects/{PROJECT_ID}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["projects"], [])
        delete_project.assert_called_once()

    def test_member_cannot_delete_project(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        with patch.object(
            auth_api,
            "require_project_leader",
            Mock(side_effect=HTTPException(status_code=403, detail="Project leader role is required")),
        ):
            response = self.client.delete(f"/projects/{PROJECT_ID}")

        self.assertEqual(response.status_code, 403)

    def test_member_can_leave_project(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        with (
            patch.object(auth_api, "get_project_membership_for_account", Mock(return_value=membership(role="member"))),
            patch.object(auth_api, "remove_project_membership_for_account", Mock(return_value=True)),
            patch.object(auth_api, "get_project_memberships_for_account", Mock(return_value=[])),
        ):
            response = self.client.delete(f"/projects/{PROJECT_ID}/membership")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["projects"], [])

    def test_leader_cannot_leave_project(self) -> None:
        self.app.dependency_overrides[auth_api.require_account] = account
        with patch.object(
            auth_api,
            "get_project_membership_for_account",
            Mock(return_value=membership(role="leader")),
        ):
            response = self.client.delete(f"/projects/{PROJECT_ID}/membership")

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
