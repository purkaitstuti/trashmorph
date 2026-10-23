import logging

import httpx
from fastapi import HTTPException

from app.core.config import get_settings

log = logging.getLogger("trashmorph.supabase")

Params = dict | list[tuple[str, str]] | None


def _fail(status_code: int) -> HTTPException:
    log.warning("supabase request failed status=%s", status_code)
    if status_code in (401, 403):
        return HTTPException(403, "Not allowed")
    if status_code == 404:
        return HTTPException(404, "Not found")
    if status_code == 409:
        return HTTPException(409, "That already exists")
    if status_code in (400, 422):
        return HTTPException(422, "That change isn't allowed or the data is invalid")
    return HTTPException(502, "Data service error")


async def _call(method: str, table: str, token: str | None, params: Params, json: dict | None, count: bool):
    s = get_settings()
    prefer = "return=representation" + (",count=exact" if count else "")
    # token=None means an anonymous (public) request; Row-Level Security decides what is visible.
    headers = {"apikey": s.supabase_anon_key, "Authorization": f"Bearer {token or s.supabase_anon_key}", "Prefer": prefer}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.request(method, f"{s.supabase_url}/rest/v1/{table}", params=params, json=json, headers=headers)
    if r.status_code >= 400:
        raise _fail(r.status_code)
    return r


async def rest(method: str, table: str, token: str | None, *, params: Params = None, json: dict | None = None):
    """Call PostgREST as the signed-in user so Row-Level Security is enforced by the database."""
    r = await _call(method, table, token, params, json, False)
    return r.json() if r.content else None


async def rest_list(table: str, token: str | None, *, params: Params = None) -> tuple[list, int]:
    """GET with an exact total count (from the Content-Range header)."""
    r = await _call("GET", table, token, params, None, True)
    rows = r.json() if r.content else []
    total = len(rows)
    cr = r.headers.get("content-range", "")
    if "/" in cr and cr.split("/")[1].isdigit():
        total = int(cr.split("/")[1])
    return rows, total


def _service_headers() -> dict:
    key = get_settings().supabase_service_role_key
    if not key:
        raise HTTPException(503, "This feature is not configured on the server")
    return {"apikey": key, "Authorization": f"Bearer {key}"}


async def service_insert(table: str, row: dict) -> None:
    s = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{s.supabase_url}/rest/v1/{table}", json=row, headers=_service_headers())
    if r.status_code >= 400:
        raise _fail(r.status_code)


STORAGE_BUCKETS = ("avatars", "listing-images")


async def delete_user_and_files(user_id: str) -> None:
    """Remove the user's stored files, then the auth user (profile, settings, listings etc. cascade)."""
    s = get_settings()
    headers = _service_headers()
    async with httpx.AsyncClient(timeout=15) as client:
        for bucket in STORAGE_BUCKETS:
            listed = await client.post(f"{s.supabase_url}/storage/v1/object/list/{bucket}", json={"prefix": user_id, "limit": 1000}, headers=headers)
            if listed.status_code >= 400:
                raise _fail(listed.status_code)
            names = [f"{user_id}/{o['name']}" for o in listed.json() if o.get("name")]
            if names:
                rm = await client.request("DELETE", f"{s.supabase_url}/storage/v1/object/{bucket}", json={"prefixes": names}, headers=headers)
                if rm.status_code >= 400:
                    raise _fail(rm.status_code)
        r = await client.delete(f"{s.supabase_url}/auth/v1/admin/users/{user_id}", headers=headers)
        if r.status_code >= 400:
            raise _fail(r.status_code)
