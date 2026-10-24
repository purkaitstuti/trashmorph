import asyncio
import time
import uuid
from collections import defaultdict, deque
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, get_current_user
from app.ml.classifier import ModelUnavailable, build_result, get_classifier
from app.ml.guidance import DISCLAIMER
from app.ml.images import read_limited, validate_image
from app.schemas.listings import Page
from app.schemas.stage4 import ClassifyResult, ScanItem
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1/waste", tags=["scanner"])
BUCKET = "scan-images"
_inference = asyncio.Semaphore(2)  # protects memory: at most two predictions at once
_hits: dict[str, deque] = defaultdict(deque)


def throttle(user_id: str, per_minute: int) -> None:
    """Per-user limit on the expensive endpoint. In-memory, so it applies per server instance."""
    now = time.monotonic()
    q = _hits[user_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        raise HTTPException(429, "You're scanning too quickly. Please wait a minute and try again.")
    q.append(now)


@router.get("/status")
async def status(settings: Settings = Depends(get_settings), user: CurrentUser = Depends(get_current_user)):
    try:
        clf = await run_in_threadpool(get_classifier, settings)
    except ModelUnavailable as e:
        return {"available": False, "reason": e.reason, "message": e.message, "model_version": None}
    return {"available": True, "reason": None, "message": None, "model_version": clf.version}


@router.post("/classify", response_model=ClassifyResult)
async def classify(
    file: UploadFile = File(...),
    save_image: bool = Form(True),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    throttle(user.id, settings.scans_per_minute)
    data = await read_limited(file, settings.max_upload_size_mb * 1024 * 1024)
    info = validate_image(data)
    try:
        clf = await run_in_threadpool(get_classifier, settings)
    except ModelUnavailable as e:
        raise HTTPException(503, e.message) from None
    try:
        async with _inference:
            preds = await run_in_threadpool(clf.predict, data)
    except Exception:  # noqa: BLE001
        raise HTTPException(500, "We couldn't analyse that image. Try a different photo.") from None
    result = build_result(preds, settings.min_confidence)

    image_path = None
    if save_image:
        path = f"{user.id}/{uuid.uuid4()}.{info.ext}"
        try:
            await db.storage_upload(user.token, BUCKET, path, data, info.content_type)
            image_path = path
        except HTTPException:
            image_path = None  # the result is still valid; just don't claim the photo was saved
    rows = await db.rest("POST", "waste_scans", user.token, json={
        "user_id": user.id, "image_path": image_path, "category": result["category"], "confidence": result["confidence"],
        "top_guess": result["top_guess"], "suggested_action": result["suggested_action"], "is_uncertain": result["is_uncertain"], "model_version": clf.version})
    return {**result, "scan_id": rows[0]["id"], "model_version": clf.version, "image_saved": image_path is not None, "disclaimer": DISCLAIMER}


@router.get("/scans", response_model=Page[ScanItem])
async def scan_history(page: int = Query(default=1, ge=1, le=1000), page_size: int = Query(default=12, ge=1, le=50), user: CurrentUser = Depends(get_current_user)):
    params = [("select", "id,image_path,category,confidence,top_guess,suggested_action,is_uncertain,created_at"), ("user_id", f"eq.{user.id}"), ("order", "created_at.desc"), ("limit", str(page_size)), ("offset", str((page - 1) * page_size))]
    rows, total = await db.rest_list("waste_scans", user.token, params=params)
    urls = await db.storage_sign(user.token, BUCKET, [r["image_path"] for r in rows if r.get("image_path")])
    items = [{**{k: v for k, v in r.items() if k != "image_path"}, "image_url": urls.get(r["image_path"]) if r.get("image_path") else None} for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.delete("/scans/{scan_id}", status_code=204)
async def delete_scan(scan_id: UUID, user: CurrentUser = Depends(get_current_user)):
    rows = await db.rest("GET", "waste_scans", user.token, params={"id": f"eq.{scan_id}", "user_id": f"eq.{user.id}", "select": "id,image_path"})
    if not rows:
        raise HTTPException(404, "Scan not found")
    await db.rest("DELETE", "waste_scans", user.token, params={"id": f"eq.{scan_id}", "user_id": f"eq.{user.id}"})
    if rows[0].get("image_path"):
        try:
            await db.storage_remove(user.token, BUCKET, [rows[0]["image_path"]])
        except HTTPException:
            pass  # row is gone; a leftover private file is removed when the account is deleted
