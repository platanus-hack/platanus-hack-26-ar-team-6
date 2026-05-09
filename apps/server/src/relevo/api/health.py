from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from relevo.config import AppConfig, ModelVersions


class HealthResponse(BaseModel):
    status: str
    sha: str
    models: ModelVersions


router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    config: AppConfig = request.app.state.config
    return HealthResponse(status="ok", sha=config.sha, models=config.models)
