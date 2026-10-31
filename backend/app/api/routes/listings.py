import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import get_settings
from app.core.security import CurrentUser, get_current_user, get_optional_user
from app.schemas.listings import Listing, ListingCreate, ListingDetail, ListingUpdate, Page, Seller, StatusChange
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["listings"])
COLS = "id,owner_id,title,description,category,quantity,unit,condition,listing_type,price,latitude,longitude,location_label,status,images,created_at,updated_at"

# Mirrors validate_listing_update() in the database, which is the final backstop.
TRANSITIONS = {
    "draft": {"active", "cancelled"},
    "active": {"reserved", "cancelled"},
    "reserved": {"active", "collected", "cancelled"},
    "collected": {"completed"},
    "completed": set(),
    "cancelled": set(),
}
EDITABLE = {"draft", "active"}
DELETABLE = {"draft", "cancelled"}


def clean_search(text: str | None, limit: int = 60) -> str:
    """Keep letters, digits, spaces and hyphens so the text can't alter the PostgREST filter syntax."""
    return re.sub(r"[^\w\s-]", "", text or "", flags=re.UNICODE).strip()[:limit]


def check_images(urls: list[str], user_id: str) -> None:
    prefix = f"{get_settings().supabase_url.rstrip('/')}/storage/v1/object/public/listing-images/{user_id}/"
    if any(not u.startswith(prefix) for u in urls):
        raise HTTPException(422, "Photos must be uploaded through TRASHMORPH")


def _page(items: list, total: int, page: int, size: int) -> dict:
    return {"items": items, "total": total, "page": page, "page_size": size}


async def _get_own(listing_id: UUID, user: CurrentUser) -> dict:
    rows = await db.rest("GET", "waste_listings", user.token, params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}", "select": COLS})
    if not rows:
        raise HTTPException(404, "Listing not found")
    return rows[0]


@router.get("/listings", response_model=Page[Listing])
async def browse(
    q: str | None = None,
    category: str | None = Query(default=None, pattern=r"^[a-z]+$"),
    listing_type: Literal["free", "exchange", "price"] | None = None,
    max_price: float | None = Query(default=None, ge=0, le=1_000_000),
    location: str | None = None,
    sort: Literal["newest", "price_asc", "price_desc"] = "newest",
    page: int = Query(default=1, ge=1, le=1000),
    page_size: int = Query(default=12, ge=1, le=50),
    user: CurrentUser | None = Depends(get_optional_user),
):
    params: list[tuple[str, str]] = [("select", COLS), ("status", "eq.active")]
    if user:
        profiles = await db.rest("GET", "profiles", user.token, params={"id": f"eq.{user.id}", "select": "role"})
        if profiles and profiles[0].get("role") == "recycler":
            params.append(("seller_type", "eq.household"))
    if category:
        params.append(("category", f"eq.{category}"))
    if listing_type:
        params.append(("listing_type", f"eq.{listing_type}"))
    conds = []
    term = clean_search(q)
    if term:
        conds.append(f"or(title.ilike.*{term}*,description.ilike.*{term}*)")
    if max_price is not None:
        conds.append(f"or(price.is.null,price.lte.{max_price})")
    if conds:
        params.append(("and", f"({','.join(conds)})"))
    place = clean_search(location, 80)
    if place:
        params.append(("location_label", f"ilike.*{place}*"))
    order = {"newest": "created_at.desc", "price_asc": "price.asc.nullsfirst", "price_desc": "price.desc.nullslast"}[sort]
    params += [("order", order), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    rows, total = await db.rest_list("waste_listings", user.token if user else None, params=params)
    return _page(rows, total, page, page_size)


@router.get("/listings/mine", response_model=Page[Listing])
async def my_listings(
    status: Literal["draft", "active", "reserved", "collected", "completed", "cancelled"] | None = None,
    page: int = Query(default=1, ge=1, le=1000),
    page_size: int = Query(default=20, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
):
    params = [("select", COLS), ("owner_id", f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    if status:
        params.append(("status", f"eq.{status}"))
    rows, total = await db.rest_list("waste_listings", user.token, params=params)
    return _page(rows, total, page, page_size)


@router.get("/listings/{listing_id}", response_model=ListingDetail)
async def get_listing(listing_id: UUID, user: CurrentUser | None = Depends(get_optional_user)):
    token = user.token if user else None
    rows = await db.rest("GET", "waste_listings", token, params={"id": f"eq.{listing_id}", "select": COLS})
    if not rows:
        raise HTTPException(404, "Listing not found")
    row = rows[0]
    seller = await db.rest("GET", "public_profiles", token, params={"id": f"eq.{row['owner_id']}", "select": "id,full_name,avatar_url"})
    detail = {**row, "seller": Seller(**seller[0]) if seller else None, "is_owner": bool(user and user.id == row["owner_id"])}
    if user:
        fav = await db.rest("GET", "marketplace_favorites", token, params={"listing_id": f"eq.{listing_id}", "user_id": f"eq.{user.id}", "select": "id"})
        inq = await db.rest("GET", "marketplace_inquiries", token, params={"listing_id": f"eq.{listing_id}", "sender_id": f"eq.{user.id}", "select": "id"})
        detail.update(is_favorite=bool(fav), has_inquired=bool(inq))
    return detail


@router.post("/listings", response_model=Listing, status_code=201)
async def create_listing(body: ListingCreate, user: CurrentUser = Depends(get_current_user)):
    check_images(body.images, user.id)
    rows = await db.rest("POST", "waste_listings", user.token, json={**body.model_dump(), "owner_id": user.id})
    return rows[0]


@router.patch("/listings/{listing_id}", response_model=Listing)
async def update_listing(listing_id: UUID, body: ListingUpdate, user: CurrentUser = Depends(get_current_user)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "No changes supplied")
    current = await _get_own(listing_id, user)
    if current["status"] not in EDITABLE:
        raise HTTPException(409, f"A {current['status']} listing can't be edited")
    if "images" in changes:
        check_images(changes["images"] or [], user.id)
    merged = {**current, **changes}
    if merged["listing_type"] == "price" and merged.get("price") is None:
        raise HTTPException(422, "A price is required for priced listings")
    if merged["listing_type"] != "price":
        changes["price"] = None
    if (merged.get("latitude") is None) != (merged.get("longitude") is None):
        raise HTTPException(422, "Latitude and longitude must be given together")
    rows = await db.rest("PATCH", "waste_listings", user.token, params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}", "select": COLS}, json=changes)
    return rows[0]


@router.post("/listings/{listing_id}/status", response_model=Listing)
async def change_status(listing_id: UUID, body: StatusChange, user: CurrentUser = Depends(get_current_user)):
    current = await _get_own(listing_id, user)
    if body.status not in TRANSITIONS[current["status"]]:
        raise HTTPException(409, f"Can't change a {current['status']} listing to {body.status}")
    rows = await db.rest("PATCH", "waste_listings", user.token, params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}", "select": COLS}, json={"status": body.status})
    return rows[0]


@router.delete("/listings/{listing_id}", status_code=204)
async def delete_listing(listing_id: UUID, user: CurrentUser = Depends(get_current_user)):
    current = await _get_own(listing_id, user)
    if current["status"] not in DELETABLE:
        raise HTTPException(409, "Mark the listing unavailable before deleting it")
    await db.rest("DELETE", "waste_listings", user.token, params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}"})
