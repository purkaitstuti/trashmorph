import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

from app.schemas.profiles import ContactIn
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["contact"])

# Simple per-IP limit (5 per 10 minutes). In-memory, so it is per server instance only.
_hits: dict[str, deque] = defaultdict(deque)
LIMIT, WINDOW = 5, 600


def _throttle(ip: str) -> None:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(429, "Too many messages. Please try again later.")
    q.append(now)


@router.post("/contact", status_code=201)
async def send_contact(body: ContactIn, request: Request):
    _throttle(request.client.host if request.client else "unknown")
    await db.service_insert("contact_messages", {"name": body.name.strip(), "email": body.email, "message": body.message.strip()})
    return {"status": "received"}
