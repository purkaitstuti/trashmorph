import asyncio
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import CurrentUser, get_current_user
from app.schemas.stage3 import Material
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["analytics"])
ROW_CAP = 2000
STATUSES = ["requested", "accepted", "scheduled", "in_progress", "completed", "cancelled", "rejected"]


def to_date(ts: str) -> date:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).date()


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_starts(start: date, end: date) -> list[date]:
    weeks, d = [], monday(start)
    while d <= end:
        weeks.append(d)
        d += timedelta(days=7)
    return weeks


def weekly(rows: list[dict], start: date, end: date, field: str = "created_at", weight: str | None = None) -> list[dict]:
    totals: Counter = Counter()
    for r in rows:
        totals[monday(to_date(r[field]))] += r[weight] if weight else 1
    return [{"week": w.isoformat(), "value": totals.get(w, 0)} for w in week_starts(start, end)]


def counts(rows: list[dict], key: str) -> list[dict]:
    c = Counter(r[key] for r in rows)
    return [{"key": k, "count": n} for k, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))]


@router.get("/analytics")
async def analytics(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    category: Material | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """Every number is computed from the signed-in user's own records. Counts are events, never weights or carbon estimates."""
    end = date_to or date.today()
    start = date_from or end - timedelta(days=90)
    if start > end:
        raise HTTPException(422, "The start date must be before the end date")
    if (end - start).days > 730:
        raise HTTPException(422, "Choose a range of two years or less")
    me = f"eq.{user.id}"
    window = [("created_at", f"gte.{start.isoformat()}T00:00:00Z"), ("created_at", f"lte.{end.isoformat()}T23:59:59Z")]
    cat = [("category", f"eq.{category}")] if category else []

    def q(table: str, select: str, *extra: tuple[str, str]):
        return db.rest_list(table, user.token, params=[("select", select), *extra, *window, ("order", "created_at.asc"), ("limit", str(ROW_CAP))])

    (listings, n_l), (collections, n_c), (points, n_p), (scans, n_s) = await asyncio.gather(
        q("waste_listings", "category,status,created_at", ("owner_id", me), *cat),
        q("collection_requests", "status,created_at,updated_at,requester_id,owner_id", ("or", f"(requester_id.eq.{user.id},owner_id.eq.{user.id})")),
        q("greenscore_transactions", "points,created_at", ("user_id", me)),
        q("waste_scans", "category,created_at", ("user_id", me), *cat),
    )
    by_status = []
    for s in STATUSES:
        by_status.append({"status": s,
                          "as_requester": sum(1 for c in collections if c["status"] == s and c["requester_id"] == user.id),
                          "as_owner": sum(1 for c in collections if c["status"] == s and c["owner_id"] == user.id)})
    completed = [c for c in collections if c["status"] == "completed"]
    completed_weekly = {w["week"]: w["value"] for w in weekly(completed, start, end, field="updated_at")}
    requested_weekly = weekly(collections, start, end)
    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "category": category,
        "totals": {"listings": n_l, "collection_requests": n_c, "completed_collections": len(completed), "points": sum(p["points"] for p in points), "scans": n_s},
        "listings_by_category": counts(listings, "category"),
        "listings_over_time": weekly(listings, start, end),
        "collections_by_status": by_status,
        "collections_over_time": [{"week": w["week"], "requested": w["value"], "completed": completed_weekly.get(w["week"], 0)} for w in requested_weekly],
        "points_over_time": weekly(points, start, end, weight="points"),
        "scans_by_category": counts(scans, "category"),
        "truncated": max(n_l, n_c, n_p, n_s) > ROW_CAP,
    }
