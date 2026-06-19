from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Subscription, User
from ..schemas import SubscriptionOut

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("", response_model=SubscriptionOut)
def get_subscription(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubscriptionOut:
    subscription = db.query(Subscription).filter(Subscription.user_id == user.id).one_or_none()
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return SubscriptionOut.model_validate(subscription)
