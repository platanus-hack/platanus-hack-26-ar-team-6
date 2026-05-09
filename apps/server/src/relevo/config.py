from __future__ import annotations

import os

from pydantic import BaseModel, Field


class ModelVersions(BaseModel):
    agent: str = "sonnet-4-6"
    router: str = "haiku-4-5-20251001"


class AppConfig(BaseModel):
    sha: str
    models: ModelVersions = Field(default_factory=ModelVersions)


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int


def load_app_config() -> AppConfig:
    return AppConfig(
        sha=os.environ.get("GIT_SHA")
        or os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or "dev"
    )


def load_server_config() -> ServerConfig:
    return ServerConfig(port=int(os.environ["PORT"]))
