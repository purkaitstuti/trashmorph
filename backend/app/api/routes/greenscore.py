from fastapi import APIRouter, Depends, Query

from app.core.security import CurrentUser, get_current_user
from app.schemas.listings import Page
from app.schemas.stage3 import Transaction
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1/greenscore", tags=["greenscore"])

# Must match the numbers in supabase/migrations/0003 (award_points calls). The database is the source of truth for awards.
POLICY = [
    {"activity_type": "listing_published", "label": "Publish a listing", "points": 5, "daily_cap": 3, "verification": "user_reported"},
    {"activity_type": "collection_collected", "label": "Collect an item (request completed)", "points": 20, "daily_cap": 5, "verification": "counterparty_confirmed"},
    {"activity_type": "collection_handed_over", "label": "Hand over an item (request completed)", "points": 15, "daily_cap": 5, "verification": "counterparty_confirmed"},
    {"activity_type": "food_donation_reported", "label": "Report a food donation handover", "points": 10, "daily_cap": 3, "verification": "user_reported"},
]
LEVELS = [(0, "Seedling"), (50, "Sprout"), (150, "Sapling"), (400, "Grove")]


def level_for(total: int) -> dict:
    current = max((t for t in LEVELS if total >= t[0]), key=lambda t: t[0])
    nxt = next((t for t in LEVELS if t[0] > total), None)
    return {"name": current[1], "min_points": current[0], "next_name": nxt[1] if nxt else None, "next_at": nxt[0] if nxt else None}


def badges_for(events: dict[str, int], total: int) -> list[dict]:
    done = events.get("collection_collected", 0) + events.get("collection_handed_over", 0)
    defs = [
        ("first_listing", "First listing", "Publish your first listing", events.get("listing_published", 0) >= 1),
        ("first_handover", "First handover", "Complete one collection", done >= 1),
        ("community_helper", "Community helper", "Complete 5 collections", done >= 5),
        ("food_rescuer", "Food rescuer", "Report a food donation handover", events.get("food_donation_reported", 0) >= 1),
        ("sprout", "Sprout", "Reach 50 points", total >= 50),
        ("grove", "Grove", "Reach 400 points", total >= 400),
    ]
    return [{"key": k, "label": label, "criteria": c, "earned": e} for k, label, c, e in defs]


@router.get("")
async def summary(user: CurrentUser = Depends(get_current_user)):
    total = await db.rest("POST", "rpc/my_greenscore", user.token, json={})
    rows = await db.rest("POST", "rpc/my_greenscore_breakdown", user.token, json={})
    breakdown = [{"activity_type": r["activity_type"], "points": r["points"], "events": r["events"]} for r in rows or []]
    events = {r["activity_type"]: r["events"] for r in breakdown}
    total = int(total or 0)
    return {"total": total, "level": level_for(total), "breakdown": breakdown, "badges": badges_for(events, total), "policy": POLICY}


@router.get("/history", response_model=Page[Transaction])
async def history(page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=20, ge=1, le=50), user: CurrentUser = Depends(get_current_user)):
    params = [("select", "id,points,activity_type,description,verification,created_at"), ("user_id", f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    rows, total = await db.rest_list("greenscore_transactions", user.token, params=params)
    return {"items": rows, "total": total, "page": page, "page_size": page_size}
