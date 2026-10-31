from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.routes.listings import COLS
from app.core.security import CurrentUser, get_current_user
from app.schemas.listings import Inquiry, InquiryIn, InquiryReplyIn, Listing, Page, ReportIn
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["marketplace"])


async def _active_listing(listing_id: UUID, user: CurrentUser) -> dict:
    rows = await db.rest("GET", "waste_listings", user.token, params={"id": f"eq.{listing_id}", "select": "id,owner_id,status"})
    if not rows or rows[0]["status"] != "active" and rows[0]["owner_id"] != user.id:
        raise HTTPException(404, "Listing not found")
    return rows[0]


@router.put("/listings/{listing_id}/favorite", status_code=204)
async def add_favorite(listing_id: UUID, user: CurrentUser = Depends(get_current_user)):
    await _active_listing(listing_id, user)
    try:
        await db.rest("POST", "marketplace_favorites", user.token, json={"user_id": user.id, "listing_id": str(listing_id)})
    except HTTPException as e:
        if e.status_code != 409:  # already saved: treat as success
            raise


@router.delete("/listings/{listing_id}/favorite", status_code=204)
async def remove_favorite(listing_id: UUID, user: CurrentUser = Depends(get_current_user)):
    await db.rest("DELETE", "marketplace_favorites", user.token, params={"listing_id": f"eq.{listing_id}", "user_id": f"eq.{user.id}"})


@router.get("/favorites", response_model=Page[Listing])
async def favorites(page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=12, ge=1, le=50), user: CurrentUser = Depends(get_current_user)):
    params = [("select", f"created_at,listing:waste_listings({COLS})"), ("user_id", f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    rows, total = await db.rest_list("marketplace_favorites", user.token, params=params)
    # Listings that are no longer visible (cancelled, reserved by someone else) come back null: skip them.
    return {"items": [r["listing"] for r in rows if r.get("listing")], "total": total, "page": page, "page_size": page_size}


@router.post("/listings/{listing_id}/inquiries", status_code=201)
async def send_inquiry(listing_id: UUID, body: InquiryIn, user: CurrentUser = Depends(get_current_user)):
    listing = await _active_listing(listing_id, user)
    if listing["status"] != "active":
        raise HTTPException(409, "This listing isn't accepting inquiries")
    if listing["owner_id"] == user.id:
        raise HTTPException(400, "You can't send an inquiry about your own listing")
    try:
        await db.rest("POST", "marketplace_inquiries", user.token, json={
            "listing_id": str(listing_id), "sender_id": user.id, "recipient_id": listing["owner_id"],
            "message": body.message.strip(), "reply_contact": (body.reply_contact or "").strip() or None})
    except HTTPException as e:
        if e.status_code == 409:
            raise HTTPException(409, "You've already sent an inquiry about this listing") from None
        raise
    return {"status": "sent"}


@router.get("/inquiries", response_model=Page[Inquiry])
async def list_inquiries(box: Literal["received", "sent"] = "received", page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=20, ge=1, le=50), user: CurrentUser = Depends(get_current_user)):
    mine, other = ("recipient_id", "sender_id") if box == "received" else ("sender_id", "recipient_id")
    params = [("select", f"id,listing_id,{other},message,reply_contact,status,created_at,listing:waste_listings(title)"), (mine, f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    rows, total = await db.rest_list("marketplace_inquiries", user.token, params=params)
    names: dict[str, str | None] = {}
    ids = sorted({r[other] for r in rows})
    if ids:
        profs = await db.rest("GET", "public_profiles", user.token, params={"id": f"in.({','.join(ids)})", "select": "id,full_name"})
        names = {p["id"]: p["full_name"] for p in profs or []}
    items = [{**r, "listing_title": (r.get("listing") or {}).get("title") or "Listing no longer available", "other_party_name": names.get(r[other])} for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def _inquiry_thread(inquiry_id: UUID, user: CurrentUser) -> dict:
    rows = await db.rest("GET", "marketplace_inquiries", user.token, params={"id": f"eq.{inquiry_id}", "select": "id,listing_id,sender_id,recipient_id,message,reply_contact,status,created_at,listing:waste_listings(title)"})
    if not rows:
        raise HTTPException(404, "Inquiry not found")
    inquiry = rows[0]
    if user.id not in (inquiry["sender_id"], inquiry["recipient_id"]):
        raise HTTPException(404, "Inquiry not found")
    replies = await db.rest("GET", "marketplace_inquiry_replies", user.token, params={"inquiry_id": f"eq.{inquiry_id}", "select": "id,sender_id,recipient_id,message,created_at", "order": "created_at.asc", "limit": "500"})
    ids = {inquiry["sender_id"], inquiry["recipient_id"], *(r["sender_id"] for r in replies or [])}
    names = {}
    if ids:
        profiles = await db.rest("GET", "public_profiles", user.token, params={"id": f"in.({','.join(sorted(ids))})", "select": "id,full_name"})
        names = {p["id"]: p.get("full_name") for p in profiles or []}
    return {
        "id": inquiry["id"], "listing_id": inquiry["listing_id"], "listing_title": (inquiry.get("listing") or {}).get("title") or "Listing no longer available",
        "sender_id": inquiry["sender_id"], "recipient_id": inquiry["recipient_id"], "sender_name": names.get(inquiry["sender_id"]),
        "recipient_name": names.get(inquiry["recipient_id"]), "message": inquiry["message"], "reply_contact": inquiry.get("reply_contact"),
        "status": inquiry["status"], "created_at": inquiry["created_at"],
        "replies": [{**r, "sender_name": names.get(r["sender_id"]), "is_mine": r["sender_id"] == user.id} for r in replies or []],
    }


@router.get("/inquiries/{inquiry_id}/thread")
async def get_inquiry_thread(inquiry_id: UUID, user: CurrentUser = Depends(get_current_user)):
    return await _inquiry_thread(inquiry_id, user)


@router.post("/inquiries/{inquiry_id}/replies", status_code=201)
async def reply_to_inquiry(inquiry_id: UUID, body: InquiryReplyIn, user: CurrentUser = Depends(get_current_user)):
    thread = await _inquiry_thread(inquiry_id, user)
    recipient_id = thread["recipient_id"] if thread["sender_id"] == user.id else thread["sender_id"]
    await db.rest("POST", "marketplace_inquiry_replies", user.token, json={
        "inquiry_id": str(inquiry_id), "sender_id": user.id, "recipient_id": recipient_id, "message": body.message.strip(),
    })
    return await _inquiry_thread(inquiry_id, user)


@router.post("/inquiries/{inquiry_id}/read", status_code=204)
async def mark_inquiry_read(inquiry_id: UUID, user: CurrentUser = Depends(get_current_user)):
    rows = await db.rest("PATCH", "marketplace_inquiries", user.token, params={"id": f"eq.{inquiry_id}", "recipient_id": f"eq.{user.id}", "select": "id"}, json={"status": "read"})
    if not rows:
        raise HTTPException(404, "Inquiry not found")


@router.post("/listings/{listing_id}/report", status_code=201)
async def report_listing(listing_id: UUID, body: ReportIn, user: CurrentUser = Depends(get_current_user)):
    listing = await _active_listing(listing_id, user)
    if listing["owner_id"] == user.id:
        raise HTTPException(400, "You can't report your own listing")
    try:
        await db.rest("POST", "listing_reports", user.token, json={"listing_id": str(listing_id), "reporter_id": user.id, "reason": body.reason, "details": (body.details or "").strip() or None})
    except HTTPException as e:
        if e.status_code == 409:
            raise HTTPException(409, "You've already reported this listing") from None
        raise
    return {"status": "reported"}
