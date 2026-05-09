from __future__ import annotations

import os

from pydantic import BaseModel, Field


class ModelVersions(BaseModel):
    agent: str = "sonnet-4-6"
    router: str = "haiku-4-5-20251001"


class OnDemandAgentConfig(BaseModel):
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 1200
    timeout_seconds: float = 20
    retrieval_top_k: int = 6


class GoogleOAuthConfig(BaseModel):
    client_id: str | None = None
    client_secret: str | None = None
    redirect_uri: str | None = None
    auth_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url: str = "https://oauth2.googleapis.com/token"
    userinfo_url: str = "https://openidconnect.googleapis.com/v1/userinfo"
    state_ttl_seconds: int = 600
    exchange_code_ttl_seconds: int = 120
    session_ttl_seconds: int = 60 * 60 * 24 * 30


class AppConfig(BaseModel):
    sha: str
    models: ModelVersions = Field(default_factory=ModelVersions)
    on_demand_agent: OnDemandAgentConfig = Field(default_factory=OnDemandAgentConfig)
    google_oauth: GoogleOAuthConfig = Field(default_factory=GoogleOAuthConfig)


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int


def load_app_config() -> AppConfig:
    return AppConfig(
        sha=os.environ.get("GIT_SHA")
        or os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or "dev",
        on_demand_agent=load_on_demand_agent_config(),
        google_oauth=load_google_oauth_config(),
    )


def load_server_config() -> ServerConfig:
    return ServerConfig(port=int(os.environ["PORT"]))


def load_on_demand_agent_config() -> OnDemandAgentConfig:
    return OnDemandAgentConfig(
        model=os.environ.get("ON_DEMAND_AGENT_MODEL", "claude-sonnet-4-6"),
        max_tokens=int(os.environ.get("ON_DEMAND_AGENT_MAX_TOKENS", "1200")),
        timeout_seconds=float(os.environ.get("ON_DEMAND_AGENT_TIMEOUT_SECONDS", "20")),
        retrieval_top_k=int(os.environ.get("ON_DEMAND_RETRIEVAL_TOP_K", "6")),
    )


def load_google_oauth_config() -> GoogleOAuthConfig:
    return GoogleOAuthConfig(
        client_id=os.environ.get("GOOGLE_CLIENT_ID"),
        client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
        redirect_uri=os.environ.get("GOOGLE_REDIRECT_URI"),
        auth_url=os.environ.get(
            "GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"
        ),
        token_url=os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
        userinfo_url=os.environ.get(
            "GOOGLE_USERINFO_URL", "https://openidconnect.googleapis.com/v1/userinfo"
        ),
        state_ttl_seconds=int(os.environ.get("GOOGLE_OAUTH_STATE_TTL_SECONDS", "600")),
        exchange_code_ttl_seconds=int(
            os.environ.get("DESKTOP_LOGIN_EXCHANGE_TTL_SECONDS", "120")
        ),
        session_ttl_seconds=int(os.environ.get("ACCOUNT_SESSION_TTL_SECONDS", str(60 * 60 * 24 * 30))),
    )
