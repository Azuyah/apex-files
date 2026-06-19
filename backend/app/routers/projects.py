from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Project, User
from ..schemas import ProjectCreateIn, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProjectOut]:
    rows = (
        db.query(Project)
        .filter(Project.user_id == user.id)
        .order_by(desc(Project.updated_at))
        .limit(100)
        .all()
    )
    return [ProjectOut.model_validate(row) for row in rows]


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    row = Project(user_id=user.id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return ProjectOut.model_validate(row)


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    row = db.get(Project, project_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
