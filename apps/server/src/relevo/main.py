from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from relevo.admin import ensure_schema, env_flag, seed_if_empty
from relevo.api.auth import router as auth_router
from relevo.api.context import router as context_router
from relevo.api.health import router as health_router
from relevo.api.team_pulse import router as team_pulse_router
from relevo.config import AppConfig, load_app_config
from relevo.db import close_pool, init_pool

logger = logging.getLogger("relevo.startup")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    logger.info("Connection pool initialized")
    if env_flag("AUTO_MIGRATE"):
        changed = ensure_schema()
        logger.info("AUTO_MIGRATE completed changed=%s", changed)
    if env_flag("AUTO_SEED"):
        changed = seed_if_empty()
        logger.info("AUTO_SEED completed changed=%s", changed)
    yield
    close_pool()
    logger.info("Connection pool closed")


def create_app(config: AppConfig | None = None) -> FastAPI:
    app = FastAPI(title="Relevo Server", lifespan=lifespan)
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
    app.include_router(team_pulse_router)

    return app


app = create_app()
