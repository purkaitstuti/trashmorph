from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Material = Literal["plastic", "paper", "cardboard", "glass", "metal", "organic", "electronic", "textile", "general", "other"]
RecyclerType = Literal["recycling_center", "scrap_dealer", "ewaste_point", "community_facility", "composting", "reuse_org"]
CollectionStatus = Literal["requested", "accepted", "scheduled", "in_progress", "completed", "cancelled", "rejected"]


class Recycler(BaseModel):
    id: str
    name: str
    description: str | None = None
    accepted_materials: list[str] = []
    recycler_type: str
    latitude: float
    longitude: float
    address: str | None = None
    contact_information: str | None = None
    source: str
    verification_status: str
    distance_km: float | None = None
    is_mine: bool = False


class RecyclerList(BaseModel):
    items: list[Recycler]
    total: int
    truncated: bool = False


class RecyclerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    accepted_materials: list[Material] = Field(min_length=1, max_length=10)
    recycler_type: RecyclerType
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=200)
    contact_information: str | None = Field(default=None, max_length=200)


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    listing_id: UUID
    quantity: float = Field(gt=0, le=1_000_000)
    requested_date: date
    time_window: Literal["any", "morning", "afternoon", "evening"] = "any"
    instructions: str | None = Field(default=None, max_length=500)

    @field_validator("requested_date")
    @classmethod
    def _in_range(cls, v: date) -> date:
        today = date.today()
        if v < today or v > today + timedelta(days=365):
            raise ValueError("date must be within the next year")
        return v


class CollectionStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: CollectionStatus


class CollectionItem(BaseModel):
    id: str
    listing_id: str
    listing_title: str
    quantity: float
    requested_date: str
    time_window: str
    instructions: str | None = None
    status: str
    role: str  # "requester" or "owner": the signed-in user's part in this request
    other_party_name: str | None = None
    created_at: str
    updated_at: str


class HistoryEntry(BaseModel):
    previous_status: str | None = None
    new_status: str
    changed_by_role: str | None = None  # "requester", "owner" or None
    created_at: str


class CollectionDetail(CollectionItem):
    history: list[HistoryEntry]
    allowed_actions: list[str]


class Transaction(BaseModel):
    id: str
    points: int
    activity_type: str
    description: str
    verification: str
    created_at: str
