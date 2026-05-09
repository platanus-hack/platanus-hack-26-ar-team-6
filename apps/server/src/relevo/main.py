from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from relevo.admin import ensure_schema, env_flag, seed_if_empty
from relevo.api.auth import router as auth_router
from relevo.api.context import router as context_router
from relevo.api.health import router as health_router
from relevo.config import AppConfig, load_app_config

logger = logging.getLogger("relevo.startup")


def create_app(config: AppConfig | None = None) -> FastAPI:
    app = FastAPI(title="Relevo Server")
    app.state.config = config or load_app_config()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(context_router)

    @app.on_event("startup")
    def initialize_database() -> None:
        if env_flag("AUTO_MIGRATE"):
            changed = ensure_schema()
            logger.info("AUTO_MIGRATE completed changed=%s", changed)
        if env_flag("AUTO_SEED"):
            changed = seed_if_empty()
            logger.info("AUTO_SEED completed changed=%s", changed)

    return app


app = create_app()
