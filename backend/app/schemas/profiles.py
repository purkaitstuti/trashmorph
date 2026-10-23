from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Profile(BaseModel):
    id: str
    email: str | None = None
    full_name: str | None = None
    avatar_url: str | None = None
    preferred_location: str | None = None
    role: str = "user"
    created_at: str | None = None


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=500, pattern=r"^https://")
    preferred_location: str | None = Field(default=None, max_length=120)


class NotificationPrefs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    in_app: bool = True
    email: bool = False


class SettingsOut(BaseModel):
    theme: Literal["light", "dark", "system"]
    notification_preferences: NotificationPrefs


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: Literal["light", "dark", "system"] | None = None
    notification_preferences: NotificationPrefs | None = None


class DeleteAccount(BaseModel):
    confirm: Literal["DELETE"]


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    message: str = Field(min_length=10, max_length=2000)
