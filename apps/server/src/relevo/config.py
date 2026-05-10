from __future__ import annotations

import os

from pydantic import BaseModel, Field


class ModelVersions(BaseModel):
    user_agent: str = "claude-code-sdk-session"
    retriever: str = "vector-retrieval-client"
    updater: str = "claude-code-sdk-session"


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


class EmbeddingConfig(BaseModel):
    api_key: str | None = None
    model: str = "text-embedding-3-small"
    dimensions: int = 1536


class AppConfig(BaseModel):
    sha: str
    models: ModelVersions = Field(default_factory=ModelVersions)
    google_oauth: GoogleOAuthConfig = Field(default_factory=GoogleOAuthConfig)
    embeddings: EmbeddingConfig = Field(default_factory=EmbeddingConfig)


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int


def load_app_config() -> AppConfig:
    return AppConfig(
        sha=os.environ.get("GIT_SHA")
        or os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or "dev",
        google_oauth=load_google_oauth_config(),
        embeddings=load_embedding_config(),
    )


def load_server_config() -> ServerConfig:
    return ServerConfig(port=int(os.environ["PORT"]))


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
        session_ttl_seconds=int(
            os.environ.get("ACCOUNT_SESSION_TTL_SECONDS", str(60 * 60 * 24 * 30))
        ),
    )


def load_embedding_config() -> EmbeddingConfig:
    return EmbeddingConfig(
        api_key=os.environ.get("OPENAI_API_KEY"),
        model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
        dimensions=int(os.environ.get("EMBEDDING_DIMENSIONS", "1536")),
    )
