from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.security import CurrentUser, get_current_user
from app.schemas.stage3 import CollectionCreate, CollectionDetail, CollectionItem, CollectionStatusChange
from app.schemas.listings import Page
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["collections"])
COLS = "id,listing_id,requester_id,owner_id,listing_title,quantity,requested_date,time_window,instructions,status,created_at,updated_at"

# status -> {next status: roles allowed}. The database function enforces the same rules.
TRANSITIONS: dict[str, dict[str, set[str]]] = {
    "requested": {"accepted": {"owner"}, "rejected": {"owner"}, "cancelled": {"requester"}},
    "accepted": {"scheduled": {"owner"}, "cancelled": {"owner", "requester"}},
    "scheduled": {"in_progress": {"owner"}, "cancelled": {"owner", "requester"}},
    "in_progress": {"completed": {"owner"}, "cancelled": {"owner", "requester"}},
    "completed": {},
    "cancelled": {},
    "rejected": {},
}


def role_of(row: dict, user_id: str) -> str | None:
    if row["requester_id"] == user_id:
        return "requester"
    if row["owner_id"] == user_id:
        return "owner"
    return None


def allowed_actions(status: str, role: str) -> list[str]:
    return [to for to, roles in TRANSITIONS.get(status, {}).items() if role in roles]


async def _names(token: str, ids: set[str]) -> dict[str, str | None]:
    if not ids:
        return {}
    rows = await db.rest("GET", "public_profiles", token, params={"id": f"in.({','.join(sorted(ids))})", "select": "id,full_name"})
    return {r["id"]: r["full_name"] for r in rows or []}


def _item(row: dict, user_id: str, names: dict) -> dict:
    role = role_of(row, user_id)
    other = row["owner_id"] if role == "requester" else row["requester_id"]
    return {**row, "role": role, "other_party_name": names.get(other)}


async def _detail(request_id: UUID, user: CurrentUser) -> dict:
    rows = await db.rest("GET", "collection_requests", user.token, params={"id": f"eq.{request_id}", "select": COLS})
    if not rows or role_of(rows[0], user.id) is None:
        raise HTTPException(404, "Request not found")
    row = rows[0]
    hist = await db.rest("GET", "collection_status_history", user.token, params={"collection_request_id": f"eq.{request_id}", "select": "previous_status,new_status,changed_by,created_at", "order": "created_at.asc"})
    names = await _names(user.token, {row["requester_id"], row["owner_id"]})
    item = _item(row, user.id, names)
    history = [{"previous_status": h["previous_status"], "new_status": h["new_status"], "changed_by_role": role_of(row, h["changed_by"]) if h.get("changed_by") else None, "created_at": h["created_at"]} for h in hist or []]
    return {**item, "history": history, "allowed_actions": allowed_actions(row["status"], item["role"])}


@router.post("/collections", response_model=CollectionDetail, status_code=201)
async def create_request(body: CollectionCreate, user: CurrentUser = Depends(get_current_user)):
    payload = {**body.model_dump(mode="json"), "requester_id": user.id}
    rows = await db.rest("POST", "collection_requests", user.token, json=payload)
    return await _detail(UUID(rows[0]["id"]), user)


@router.get("/collections", response_model=Page[CollectionItem])
async def list_requests(
    role: Literal["requester", "owner"] = "requester",
    status: Literal["requested", "accepted", "scheduled", "in_progress", "completed", "cancelled", "rejected"] | None = None,
    page: int = Query(default=1, ge=1, le=1000),
    page_size: int = Query(default=20, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
):
    col = "requester_id" if role == "requester" else "owner_id"
    params = [("select", COLS), (col, f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    if status:
        params.append(("status", f"eq.{status}"))
    rows, total = await db.rest_list("collection_requests", user.token, params=params)
    names = await _names(user.token, {r["owner_id"] if role == "requester" else r["requester_id"] for r in rows})
    return {"items": [_item(r, user.id, names) for r in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/collections/{request_id}", response_model=CollectionDetail)
async def get_request(request_id: UUID, user: CurrentUser = Depends(get_current_user)):
    return await _detail(request_id, user)


@router.post("/collections/{request_id}/status", response_model=CollectionDetail)
async def change_status(request_id: UUID, body: CollectionStatusChange, user: CurrentUser = Depends(get_current_user)):
    current = await _detail(request_id, user)
    if body.status not in TRANSITIONS[current["status"]]:
        raise HTTPException(409, f"A {current['status'].replace('_', ' ')} request can't be changed to {body.status.replace('_', ' ')}")
    if body.status not in current["allowed_actions"]:
        raise HTTPException(403, "You can't make that change on this request")
    await db.rest("POST", "rpc/change_collection_status", user.token, json={"p_request": str(request_id), "p_status": body.status})
    return await _detail(request_id, user)
