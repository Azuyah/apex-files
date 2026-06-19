from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import auth, builds, integrations, projects, subscription
from .settings import get_settings

settings = get_settings()

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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"ok": "true", "service": "apex-files-api"}


app.include_router(auth.router, prefix="/api")
app.include_router(builds.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(subscription.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
