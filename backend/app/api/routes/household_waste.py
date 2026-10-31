from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import CurrentUser, get_current_user
from app.schemas.household_waste import HouseholdWasteLogIn, PickupRequestIn, PickupStatusIn
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1/household-waste", tags=["household waste pickup"])
CYCLE_SELECT = "id,household_id,location_label,started_at,expires_at,logs:household_waste_daily_logs(id,logged_on,biodegradable_items,non_biodegradable_items,created_at,updated_at)"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _profile(user: CurrentUser) -> dict:
    rows = await db.rest("GET", "profiles", user.token, params={"id": f"eq.{user.id}", "select": "id,role,full_name,recycler_organization,recycler_location,recycler_contact,preferred_location"})
    if not rows:
        raise HTTPException(404, "Profile not found")
    return rows[0]


async def _require_role(user: CurrentUser, role: str) -> dict:
    profile = await _profile(user)
    if profile["role"] != role:
        raise HTTPException(403, "This area is for " + ("recyclers" if role == "recycler" else "household members"))
    return profile


def _cycle_view(row: dict) -> dict:
    logs = sorted(row.get("logs") or [], key=lambda item: item["logged_on"])
    return {**row, "logs": logs, "days_logged": len(logs), "target_days": 30}


@router.get("/overview")
async def household_overview(user: CurrentUser = Depends(get_current_user)):
    await _require_role(user, "user")
    rows = await db.rest("GET", "household_waste_cycles", user.token, params={
        "household_id": f"eq.{user.id}", "expires_at": f"gt.{_now()}",
        "select": CYCLE_SELECT, "order": "started_at.desc", "limit": "10",
    })
    cycles = [_cycle_view(row) for row in rows or []]
    requests = await db.rest("GET", "household_waste_pickup_requests", user.token, params={
        "household_id": f"eq.{user.id}", "select": "id,cycle_id,recycler_id,message,status,created_at,updated_at", "order": "created_at.desc", "limit": "50",
    })
    recycler_ids = sorted({r["recycler_id"] for r in requests or []})
    profiles = await db.rest("POST", "rpc/household_waste_my_recycler_contacts", user.token, json={}) if recycler_ids else []
    names = {p["id"]: p for p in profiles or []}
    return {"cycles": cycles, "requests": [{**r, "other_party": names.get(r["recycler_id"])} for r in requests or []]}


@router.post("/logs", status_code=201)
async def save_daily_log(body: HouseholdWasteLogIn, user: CurrentUser = Depends(get_current_user)):
    profile = await _require_role(user, "user")
    today = date.today().isoformat()
    cycles = await db.rest("GET", "household_waste_cycles", user.token, params={
        "household_id": f"eq.{user.id}", "expires_at": f"gt.{_now()}", "select": "id,location_label,started_at,expires_at",
        "order": "started_at.desc", "limit": "1",
    })
    if cycles:
        cycle = cycles[0]
    else:
        location = (body.location_label or profile.get("preferred_location") or "").strip()
        if len(location) < 2:
            raise HTTPException(422, "Enter your city or neighbourhood to start a household waste log")
        created = await db.rest("POST", "household_waste_cycles", user.token, json={"household_id": user.id, "location_label": location})
        cycle = created[0]
    payload = {"biodegradable_items": body.biodegradable_items, "non_biodegradable_items": body.non_biodegradable_items}
    existing = await db.rest("GET", "household_waste_daily_logs", user.token, params={
        "cycle_id": f"eq.{cycle['id']}", "logged_on": f"eq.{today}", "select": "id", "limit": "1",
    })
    if existing:
        rows = await db.rest("PATCH", "household_waste_daily_logs", user.token, params={"id": f"eq.{existing[0]['id']}", "select": "id"}, json=payload)
    else:
        rows = await db.rest("POST", "household_waste_daily_logs", user.token, json={"cycle_id": cycle["id"], "logged_on": today, **payload})
    return {"cycle_id": cycle["id"], "log_id": rows[0]["id"], "logged_on": today}


@router.get("/available")
async def available_household_logs(
    page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=20, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
):
    await _require_role(user, "recycler")
    rows = await db.rest("POST", "rpc/household_waste_available_cycles", user.token, json={"p_limit": page_size, "p_offset": (page - 1) * page_size}) or []
    total = int(rows[0]["total_count"]) if rows else 0
    items = [{k: v for k, v in row.items() if k != "total_count"} for row in rows]
    return {"items": [_cycle_view(row) for row in items], "total": total, "page": page, "page_size": page_size}


@router.get("/requests")
async def list_pickup_requests(user: CurrentUser = Depends(get_current_user)):
    profile = await _profile(user)
    col = "recycler_id" if profile["role"] == "recycler" else "household_id"
    rows = await db.rest("GET", "household_waste_pickup_requests", user.token, params={
        col: f"eq.{user.id}", "select": "id,cycle_id,household_id,recycler_id,message,status,created_at,updated_at,cycle:household_waste_cycles(location_label,expires_at)",
        "order": "created_at.desc", "limit": "100",
    })
    other_ids = sorted({r["household_id"] if profile["role"] == "recycler" else r["recycler_id"] for r in rows or []})
    if profile["role"] == "recycler":
        other_profiles = await db.rest("GET", "public_profiles", user.token, params={
            "id": f"in.({','.join(other_ids)})" if other_ids else "eq.00000000-0000-0000-0000-000000000000", "select": "id,full_name",
        })
    else:
        other_profiles = await db.rest("POST", "rpc/household_waste_my_recycler_contacts", user.token, json={}) if other_ids else []
    by_id = {p["id"]: p for p in other_profiles or []}
    return {"items": [{**r, "other_party": by_id.get(r["household_id"] if profile["role"] == "recycler" else r["recycler_id"])} for r in rows or []]}


@router.post("/requests", status_code=201)
async def request_pickup(body: PickupRequestIn, user: CurrentUser = Depends(get_current_user)):
    await _require_role(user, "recycler")
    cycles = await db.rest("GET", "household_waste_cycles", user.token, params={"id": f"eq.{body.cycle_id}", "expires_at": f"gt.{_now()}", "select": "id,household_id"})
    if not cycles:
        raise HTTPException(404, "Household waste log not found or expired")
    cycle = cycles[0]
    if cycle["household_id"] == user.id:
        raise HTTPException(400, "You can't request your own household waste")
    rows = await db.rest("POST", "household_waste_pickup_requests", user.token, json={
        "cycle_id": str(body.cycle_id), "household_id": cycle["household_id"], "recycler_id": user.id, "message": (body.message or "").strip() or None,
    })
    return rows[0]


@router.post("/requests/{request_id}/status")
async def update_pickup_request(request_id: UUID, body: PickupStatusIn, user: CurrentUser = Depends(get_current_user)):
    profile = await _profile(user)
    rows = await db.rest("GET", "household_waste_pickup_requests", user.token, params={"id": f"eq.{request_id}", "select": "id,household_id,recycler_id,status"})
    if not rows:
        raise HTTPException(404, "Pickup request not found")
    row = rows[0]
    is_recycler = profile["role"] == "recycler" and row["recycler_id"] == user.id
    is_household = row["household_id"] == user.id
    allowed = ({"cancelled"} if row["status"] == "requested" else {"completed"} if row["status"] == "accepted" else set()) if is_recycler else (
        {"accepted", "declined"} if row["status"] == "requested" else {"cancelled"} if row["status"] == "accepted" else set()) if is_household else set()
    if body.status not in allowed:
        raise HTTPException(403, "You can't make that change to this pickup request")
    updated = await db.rest("PATCH", "household_waste_pickup_requests", user.token, params={"id": f"eq.{request_id}", "select": "id,cycle_id,household_id,recycler_id,status,created_at,updated_at"}, json={"status": body.status})
    return updated[0]
