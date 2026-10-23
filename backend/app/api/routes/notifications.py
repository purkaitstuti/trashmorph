from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import CurrentUser, get_current_user
from app.schemas.listings import Notification, Page
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])
COLS = "id,title,message,notification_type,reference_id,read_at,created_at"


@router.get("", response_model=Page[Notification])
async def list_notifications(unread_only: bool = False, page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=20, ge=1, le=50), user: CurrentUser = Depends(get_current_user)):
    params = [("select", COLS), ("user_id", f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    if unread_only:
        params.append(("read_at", "is.null"))
    rows, total = await db.rest_list("notifications", user.token, params=params)
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@router.get("/unread-count")
async def unread_count(user: CurrentUser = Depends(get_current_user)):
    _, total = await db.rest_list("notifications", user.token, params=[("select", "id"), ("user_id", f"eq.{user.id}"), ("read_at", "is.null"), ("limit", "1")])
    return {"count": total}


@router.post("/read-all", status_code=204)
async def read_all(user: CurrentUser = Depends(get_current_user)):
    await db.rest("PATCH", "notifications", user.token, params={"user_id": f"eq.{user.id}", "read_at": "is.null"}, json={"read_at": datetime.now(timezone.utc).isoformat()})


@router.post("/{notification_id}/read", status_code=204)
async def read_one(notification_id: UUID, user: CurrentUser = Depends(get_current_user)):
    rows = await db.rest("PATCH", "notifications", user.token, params={"id": f"eq.{notification_id}", "user_id": f"eq.{user.id}", "select": "id"}, json={"read_at": datetime.now(timezone.utc).isoformat()})
    if not rows:
        raise HTTPException(404, "Notification not found")
