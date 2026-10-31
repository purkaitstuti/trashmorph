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
        # Include PostgREST's error code in server logs so schema-cache failures
        # can be distinguished from genuinely missing tables without leaking details
        # to API clients.
        error_code = None
        try:
            error_code = r.json().get("code")
        except (ValueError, AttributeError):
            pass
        log.warning("supabase request failed status=%s code=%s", r.status_code, error_code)
        # PGRST205 specifically means the table is absent from PostgREST's schema
        # cache (commonly because the migration was applied to another project or
        # the cache has not reloaded yet). Preserve other 404s as ordinary not found.
        if table == "waste_scans" and r.status_code == 404 and error_code == "PGRST205":
            raise HTTPException(
                503,
                "Supabase's API has not picked up the waste_scans table yet. Confirm migration 0004 was run in the configured project, then run NOTIFY pgrst, 'reload schema' in its SQL Editor.",
            )
        household_waste_call = table.startswith("household_waste_") or table.startswith("rpc/household_waste_") or table == "rpc/activate_my_recycler_profile"
        recycler_profile_fields = table == "profiles" and any(
            field in str(params) for field in ("recycler_organization", "recycler_location", "recycler_contact")
        )
        if (household_waste_call or recycler_profile_fields) and error_code in ("PGRST202", "PGRST204", "PGRST205"):
            raise HTTPException(
                503,
                "Household Waste Pickup is not fully enabled in this Supabase project. Run migration 0008_household_waste_pickup.sql there, then run NOTIFY pgrst, 'reload schema' in its SQL Editor.",
            )
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


STORAGE_BUCKETS = ("avatars", "listing-images", "scan-images")


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


# ── Storage as the signed-in user (Storage RLS limits each user to their own folder) ──
def _user_headers(token: str) -> dict:
    return {"apikey": get_settings().supabase_anon_key, "Authorization": f"Bearer {token}"}


async def storage_upload(token: str, bucket: str, path: str, data: bytes, content_type: str) -> None:
    s = get_settings()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{s.supabase_url}/storage/v1/object/{bucket}/{path}", content=data, headers={**_user_headers(token), "Content-Type": content_type})
    if r.status_code >= 400:
        raise _fail(r.status_code)


async def storage_sign(token: str, bucket: str, paths: list[str], expires: int = 3600) -> dict[str, str]:
    """Return {path: signed_url} for private files the user owns."""
    if not paths:
        return {}
    s = get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{s.supabase_url}/storage/v1/object/sign/{bucket}", json={"expiresIn": expires, "paths": paths}, headers=_user_headers(token))
    if r.status_code >= 400:
        raise _fail(r.status_code)
    return {o["path"]: f"{s.supabase_url}/storage/v1{o['signedURL']}" for o in r.json() if o.get("signedURL")}


async def storage_remove(token: str, bucket: str, paths: list[str]) -> None:
    s = get_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.request("DELETE", f"{s.supabase_url}/storage/v1/object/{bucket}", json={"prefixes": paths}, headers=_user_headers(token))
    if r.status_code >= 400:
        raise _fail(r.status_code)
