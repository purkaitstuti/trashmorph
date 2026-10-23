from fastapi import APIRouter, Depends, HTTPException

from app.core.security import CurrentUser, get_current_user
from app.schemas.profiles import DeleteAccount, Profile, ProfileUpdate, SettingsOut, SettingsUpdate
from app.services import supabase_rest as db

router = APIRouter(prefix="/api/v1", tags=["profile"])
PROFILE_COLS = "id,full_name,avatar_url,preferred_location,role,created_at"
SETTINGS_COLS = "theme,notification_preferences"


def _one(rows: list | None):
    if not rows:
        raise HTTPException(404, "Not found")
    return rows[0]


@router.get("/profiles/me", response_model=Profile)
async def get_me(user: CurrentUser = Depends(get_current_user)):
    row = _one(await db.rest("GET", "profiles", user.token, params={"id": f"eq.{user.id}", "select": PROFILE_COLS}))
    return Profile(**row, email=user.email)


@router.patch("/profiles/me", response_model=Profile)
async def update_me(body: ProfileUpdate, user: CurrentUser = Depends(get_current_user)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "No changes supplied")
    row = _one(await db.rest("PATCH", "profiles", user.token, params={"id": f"eq.{user.id}", "select": PROFILE_COLS}, json=changes))
    return Profile(**row, email=user.email)


@router.get("/settings/me", response_model=SettingsOut)
async def get_settings_me(user: CurrentUser = Depends(get_current_user)):
    return _one(await db.rest("GET", "user_settings", user.token, params={"user_id": f"eq.{user.id}", "select": SETTINGS_COLS}))


@router.put("/settings/me", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, user: CurrentUser = Depends(get_current_user)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(400, "No changes supplied")
    return _one(await db.rest("PATCH", "user_settings", user.token, params={"user_id": f"eq.{user.id}", "select": SETTINGS_COLS}, json=changes))


@router.delete("/profiles/me", status_code=204)
async def delete_me(body: DeleteAccount, user: CurrentUser = Depends(get_current_user)):
    await db.delete_user_and_files(user.id)
