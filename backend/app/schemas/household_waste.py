from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HouseholdWasteLogIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location_label: str | None = Field(default=None, min_length=2, max_length=200)
    biodegradable_items: list[str] = Field(default_factory=list, max_length=30)
    non_biodegradable_items: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("biodegradable_items", "non_biodegradable_items")
    @classmethod
    def clean_items(cls, items: list[str]) -> list[str]:
        cleaned = [item.strip()[:100] for item in items if item.strip()]
        if len(cleaned) > 30:
            raise ValueError("Enter up to 30 items per category")
        return cleaned


class PickupRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cycle_id: UUID
    message: str | None = Field(default=None, max_length=500)


class PickupStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["accepted", "declined", "completed", "cancelled"]
