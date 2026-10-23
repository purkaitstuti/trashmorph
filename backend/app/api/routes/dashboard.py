import asyncio

from fastapi import APIRouter, Depends

from app.api.routes.listings import COLS
from app.core.security import CurrentUser, get_current_user
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["dashboard"])


async def _count(table: str, user: CurrentUser, **filters: str) -> int:
    _, total = await db.rest_list(table, user.token, params=[("select", "id"), ("limit", "1"), *filters.items()])
    return total


@router.get("/dashboard/summary")
async def summary(user: CurrentUser = Depends(get_current_user)):
    """Counts and recent items come only from this user's own records."""
    me = f"eq.{user.id}"
    total, active, new_inq, favs, unread, recent = await asyncio.gather(
        _count("waste_listings", user, owner_id=me),
        _count("waste_listings", user, owner_id=me, status="eq.active"),
        _count("marketplace_inquiries", user, recipient_id=me, status="eq.new"),
        _count("marketplace_favorites", user, user_id=me),
        _count("notifications", user, user_id=me, read_at="is.null"),
        db.rest("GET", "waste_listings", user.token, params={"select": COLS, "owner_id": me, "order": "created_at.desc", "limit": "5"}),
    )
    return {"listings_total": total, "listings_active": active, "new_inquiries": new_inq, "favorites": favs, "unread_notifications": unread, "recent_listings": recent}
