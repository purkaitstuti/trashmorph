import math
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.core.security import CurrentUser, get_current_user, get_optional_user
from app.schemas.stage3 import Material, Recycler, RecyclerCreate, RecyclerList, RecyclerType
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["recyclers"])
COLS = "id,name,description,accepted_materials,recycler_type,latitude,longitude,address,contact_information,source,verification_status,submitted_by"
MAX_RESULTS = 200


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


@router.get("/recyclers", response_model=RecyclerList)
async def list_recyclers(
    material: Material | None = None,
    recycler_type: RecyclerType | None = None,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=500),
    user: CurrentUser | None = Depends(get_optional_user),
):
    """Only records that exist in the database are returned. Row-Level Security hides unreviewed records from everyone but their submitter."""
    params = [("select", COLS), ("order", "name.asc"), ("limit", "1000")]
    if material:
        params.append(("accepted_materials", f"cs.{{{material}}}"))
    if recycler_type:
        params.append(("recycler_type", f"eq.{recycler_type}"))
    rows, _ = await db.rest_list("recyclers", user.token if user else None, params=params)
    located = lat is not None and lng is not None
    items = []
    for r in rows:
        dist = round(haversine_km(lat, lng, r["latitude"], r["longitude"]), 1) if located else None
        if located and radius_km is not None and dist > radius_km:
            continue
        items.append({**{k: v for k, v in r.items() if k != "submitted_by"}, "distance_km": dist, "is_mine": bool(user and r.get("submitted_by") == user.id)})
    if located:
        items.sort(key=lambda i: i["distance_km"])
    return {"items": items[:MAX_RESULTS], "total": len(items), "truncated": len(items) > MAX_RESULTS}


@router.post("/recyclers", status_code=201)
async def suggest_recycler(body: RecyclerCreate, user: CurrentUser = Depends(get_current_user)):
    """User suggestions start as 'pending': visible only to the submitter until someone reviews them."""
    row = {**body.model_dump(), "submitted_by": user.id, "source": "user_submitted", "verification_status": "pending"}
    await db.rest("POST", "recyclers", user.token, json=row)
    return {"status": "submitted"}
