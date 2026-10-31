import math
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import get_settings
from app.core.security import CurrentUser, get_current_user, get_optional_user
from app.schemas.food_rescue import DonationCreate, DonationOutcome, DonationReport, DonationUpdate, OrganizationList
from app.schemas.listings import Page
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1/food-rescue", tags=["food-rescue"])
DONATION_COLS = "id,donor_id,donor_type,donor_organization_name,title,food_category,description,quantity,unit,prepared_at,storage_conditions,allergens,pickup_deadline,location_label,latitude,longitude,photo_url,status,organization_id,reported_quantity,donated_at,verification,created_at,updated_at"
ORG_COLS = "id,name,organization_type,address,latitude,longitude,contact_number,website,operating_hours,donation_requirements,verification_status"
PUBLIC_DONATION_COLS = "id,title,food_category,description,quantity,unit,prepared_at,storage_conditions,allergens,pickup_deadline,location_label,latitude,longitude,photo_url,status,reported_quantity,donated_at,verification,created_at,updated_at"
MAX_RESULTS = 200


def check_photo(url: str | None, user_id: str):
    if url is None:
        return
    prefix = f"{get_settings().supabase_url.rstrip('/')}/storage/v1/object/public/food-rescue-images/{user_id}/"
    if not url.startswith(prefix):
        raise HTTPException(422, "Photos must be uploaded through TRASHMORPH")


def haversine_km(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    x = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(math.radians(d-b)/2)**2
    return 6371.0088 * 2 * math.asin(math.sqrt(x))


@router.get("/organizations", response_model=OrganizationList)
async def organizations(lat: float | None = Query(default=None, ge=-90, le=90), lng: float | None = Query(default=None, ge=-180, le=180), radius_km: float = Query(default=50, gt=0, le=500), q: str | None = Query(default=None, max_length=100), organization_type: str | None = Query(default=None, pattern="^(food_bank|community_kitchen|shelter|ngo|other)$")):
    rows, _ = await db.rest_list("food_rescue_organizations", None, params=[("select", ORG_COLS), ("order", "name.asc"), ("limit", "1000")])
    found = []
    for r in rows:
        if organization_type and r["organization_type"] != organization_type:
            continue
        dist = round(haversine_km(lat, lng, r["latitude"], r["longitude"]), 1) if lat is not None and lng is not None else None
        if dist is not None and dist > radius_km:
            continue
        if q and q.casefold() not in " ".join(str(r.get(k) or "") for k in ("name", "address", "organization_type", "donation_requirements")).casefold():
            continue
        found.append({**r, "distance_km": dist})
    if lat is not None and lng is not None:
        found.sort(key=lambda r: r["distance_km"])
    return {"items": found[:MAX_RESULTS], "total": len(found)}


@router.get("/donations", response_model=Page[dict])
async def donations(status: str | None = None, mine: bool = False, page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=20, ge=1, le=50), user: CurrentUser | None = Depends(get_optional_user)):
    if mine and not user:
        raise HTTPException(401, "Sign in to view your donations")
    if mine:
        await db.rest("POST", "rpc/expire_my_food_donations", user.token, json={})
    params = [("select", DONATION_COLS if mine else PUBLIC_DONATION_COLS), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page-1)*page_size))]
    if mine:
        params.append(("donor_id", f"eq.{user.id}"))
    if status and mine:
        params.append(("status", f"eq.{status}"))
    table = "food_donations" if mine else "food_donations_public"
    rows, total = await db.rest_list(table, user.token if user else None, params=params)
    return {"items": rows, "total": total, "page": page, "page_size": page_size}


@router.post("/donations", response_model=dict, status_code=201)
async def create_donation(body: DonationCreate, user: CurrentUser = Depends(get_current_user)):
    data = body.model_dump(mode="json")
    check_photo(body.photo_url, user.id)
    # Public listing coordinates are deliberately coarsened to roughly 1 km.
    data["latitude"] = round(body.latitude, 2)
    data["longitude"] = round(body.longitude, 2)
    data.update({"donor_id": user.id, "status": "available", "verification": "not_verified"})
    rows = await db.rest("POST", "food_donations", user.token, json=data)
    return rows[0]


@router.patch("/donations/{donation_id}", response_model=dict)
async def update_donation(donation_id: UUID, body: DonationUpdate, user: CurrentUser = Depends(get_current_user)):
    current = await _own_donation(donation_id, user)
    if current["status"] != "available":
        raise HTTPException(409, "Only available donations can be edited")
    patch = body.model_dump(exclude_unset=True, mode="json")
    check_photo(patch.get("photo_url"), user.id)
    if "latitude" in patch:
        patch["latitude"] = round(patch["latitude"], 2)
    if "longitude" in patch:
        patch["longitude"] = round(patch["longitude"], 2)
    rows = await db.rest("PATCH", "food_donations", user.token, params={"id": f"eq.{donation_id}"}, json=patch)
    return rows[0]


async def _own_donation(donation_id: UUID, user: CurrentUser):
    rows = await db.rest("GET", "food_donations", user.token, params={"id": f"eq.{donation_id}", "select": DONATION_COLS})
    if not rows or rows[0]["donor_id"] != user.id:
        raise HTTPException(404, "Donation not found")
    return rows[0]


@router.post("/donations/{donation_id}/outcome", response_model=dict)
async def outcome(donation_id: UUID, body: DonationOutcome, user: CurrentUser = Depends(get_current_user)):
    current = await _own_donation(donation_id, user)
    if current["status"] != "available":
        raise HTTPException(409, "This donation already has an outcome")
    if body.status == "donated":
        if body.reported_quantity is None or body.donated_at is None:
            raise HTTPException(422, "Enter the donated quantity and date")
        if body.reported_quantity > current["quantity"]:
            raise HTTPException(422, "Reported quantity exceeds the listed quantity")
        if body.organization_id:
            org = await db.rest("GET", "food_rescue_organizations", user.token, params={"id": f"eq.{body.organization_id}", "select": "id"})
            if not org:
                raise HTTPException(422, "Choose an organization in the directory")
    payload = {"p_donation": str(donation_id), "p_status": body.status, "p_organization": str(body.organization_id) if body.organization_id else None, "p_quantity": body.reported_quantity, "p_donated_at": body.donated_at.isoformat() if body.donated_at else None}
    await db.rest("POST", "rpc/record_food_donation_outcome", user.token, json=payload)
    return (await _own_donation(donation_id, user))


@router.delete("/donations/{donation_id}", status_code=204)
async def delete_donation(donation_id: UUID, user: CurrentUser = Depends(get_current_user)):
    current = await _own_donation(donation_id, user)
    if current["status"] not in ("available", "cancelled", "expired"):
        raise HTTPException(409, "Reported donations can't be removed")
    await db.rest("DELETE", "food_donations", user.token, params={"id": f"eq.{donation_id}"})


@router.post("/donations/{donation_id}/report", status_code=201)
async def report_donation(donation_id: UUID, body: DonationReport, user: CurrentUser = Depends(get_current_user)):
    row = await db.rest("GET", "food_donations", user.token, params={"id": f"eq.{donation_id}", "select": "id,status,donor_id"})
    if not row or row[0]["status"] != "available" or row[0]["donor_id"] == user.id:
        raise HTTPException(404, "Donation not found")
    await db.rest("POST", "food_donation_reports", user.token, json={**body.model_dump(), "donation_id": str(donation_id), "reporter_id": user.id})
    return {"status": "received"}


@router.get("/dashboard")
async def dashboard(date_from: date | None = Query(default=None, alias="from"), date_to: date | None = Query(default=None, alias="to"), user: CurrentUser = Depends(get_current_user)):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "The start date must be before the end date")
    if date_from and date_to and (date_to - date_from).days > 730:
        raise HTTPException(422, "Choose a range of two years or less")
    await db.rest("POST", "rpc/expire_my_food_donations", user.token, json={})
    result = await db.rest("POST", "rpc/my_food_rescue_dashboard", user.token, json={"p_date_from": date_from.isoformat() if date_from else None, "p_date_to": date_to.isoformat() if date_to else None})
    return result or {"total_listed": 0, "reported_donated": 0, "reported_quantity": 0, "status_counts": {"available": 0, "donated": 0, "expired": 0, "cancelled": 0}, "by_category": [], "activity": [], "verification_note": "Donation outcomes are donor-reported and have not been independently verified."}
