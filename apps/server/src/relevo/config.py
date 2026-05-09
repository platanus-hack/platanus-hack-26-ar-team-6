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


class AppConfig(BaseModel):
    sha: str
    models: ModelVersions = Field(default_factory=ModelVersions)
    on_demand_agent: OnDemandAgentConfig = Field(default_factory=OnDemandAgentConfig)


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int


def load_app_config() -> AppConfig:
    return AppConfig(
        sha=os.environ.get("GIT_SHA")
        or os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or "dev",
        on_demand_agent=load_on_demand_agent_config(),
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
