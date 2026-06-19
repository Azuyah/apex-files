from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_current_user
from ..models import User
from ..schemas import BridgeStatusOut
from ..services.revtech_client import RevtechClient
from ..settings import get_settings

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/revtech", response_model=BridgeStatusOut)
async def get_revtech_status(_user: User = Depends(get_current_user)) -> BridgeStatusOut:
    settings = get_settings()
    client = RevtechClient(settings)
    try:
        health = await client.health()
        message = "Connected to Revtech service." if client.configured else health.get("message")
    except Exception as exc:
        health = None
        message = str(exc)

    return BridgeStatusOut(
        mode=settings.revtech_integration_mode,
        configured=client.configured,
        revtech_api_base_url=settings.revtech_api_base_url,
        health=health,
        message=message,
    )
