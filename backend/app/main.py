from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .database import SessionLocal, init_db
from .routers import auth, builds, integrations, projects, subscription
from .services.bootstrap import ensure_temp_admin_account
from .settings import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(title="Apex Files API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    settings.storage_path.joinpath("uploads").mkdir(parents=True, exist_ok=True)
    settings.storage_path.joinpath("outputs").mkdir(parents=True, exist_ok=True)
    init_db()
    db = SessionLocal()
    try:
        ensure_temp_admin_account(db)
    finally:
        db.close()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"ok": "true", "service": "apex-files-api"}


@app.get("/")
def root_health() -> dict[str, str]:
    return health()


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong while processing the request. Please try again."},
    )


app.include_router(auth.router, prefix="/api")
app.include_router(builds.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(subscription.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
