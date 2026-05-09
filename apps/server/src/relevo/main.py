from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from relevo.api.health import router as health_router
from relevo.config import AppConfig, load_app_config


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
    return app


app = create_app()
