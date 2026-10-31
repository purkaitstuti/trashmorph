from datetime import date, datetime, timezone
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FoodCategory = Literal["prepared_meal", "bakery", "produce", "dairy", "packaged", "other"]
FoodStatus = Literal["available", "donated", "expired", "cancelled"]
OrgType = Literal["food_bank", "community_kitchen", "shelter", "ngo", "other"]
DonorType = Literal["individual", "organization"]


class Organization(BaseModel):
    id: str
    name: str
    organization_type: OrgType
    address: str
    latitude: float
    longitude: float
    contact_number: str | None = None
    website: str | None = None
    operating_hours: str | None = None
    donation_requirements: str | None = None
    verification_status: Literal["verified", "needs_review"]
    distance_km: float | None = None


class OrganizationList(BaseModel):
    items: list[Organization]
    total: int


class DonationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=120)
    donor_type: DonorType
    donor_organization_name: str | None = Field(default=None, max_length=160)
    food_category: FoodCategory
    description: str | None = Field(default=None, max_length=1500)
    quantity: float = Field(gt=0, le=1_000_000)
    unit: Literal["kg", "g", "servings", "boxes", "bags", "items", "litres"]
    prepared_at: datetime
    storage_conditions: str = Field(min_length=2, max_length=500)
    allergens: list[str] = Field(default_factory=list, max_length=20)
    pickup_deadline: datetime
    location_label: str = Field(min_length=2, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    photo_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def check_dates(self):
        now = datetime.now(timezone.utc)
        prepared = self.prepared_at if self.prepared_at.tzinfo else self.prepared_at.replace(tzinfo=timezone.utc)
        deadline = self.pickup_deadline if self.pickup_deadline.tzinfo else self.pickup_deadline.replace(tzinfo=timezone.utc)
        if deadline <= now:
            raise ValueError("Pickup deadline must be in the future")
        if prepared > now:
            raise ValueError("Preparation time can't be in the future")
        if self.donor_type == "organization" and not (self.donor_organization_name or "").strip():
            raise ValueError("Enter the organization name")
        return self

    @field_validator("allergens")
    @classmethod
    def clean_allergens(cls, values):
        return list(dict.fromkeys(a.strip()[:60] for a in values if a.strip()))

    @field_validator("location_label")
    @classmethod
    def require_approximate_location(cls, value):
        if re.search(r"[0-9#]|\b(?:house|flat|apartment|street|road|lane|building|floor|unit|door)\b", value, re.I):
            raise ValueError("Use a neighborhood or general area, not a street address")
        return value


class DonationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=3, max_length=120)
    donor_type: DonorType | None = None
    donor_organization_name: str | None = Field(default=None, max_length=160)
    food_category: FoodCategory | None = None
    description: str | None = Field(default=None, max_length=1500)
    quantity: float | None = Field(default=None, gt=0, le=1_000_000)
    unit: Literal["kg", "g", "servings", "boxes", "bags", "items", "litres"] | None = None
    prepared_at: datetime | None = None
    storage_conditions: str | None = Field(default=None, min_length=2, max_length=500)
    allergens: list[str] | None = Field(default=None, max_length=20)
    pickup_deadline: datetime | None = None
    location_label: str | None = Field(default=None, min_length=2, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    photo_url: str | None = Field(default=None, max_length=500)

    @field_validator("location_label")
    @classmethod
    def require_approximate_location(cls, value):
        if value and re.search(r"[0-9#]|\b(?:house|flat|apartment|street|road|lane|building|floor|unit|door)\b", value, re.I):
            raise ValueError("Use a neighborhood or general area, not a street address")
        return value


class DonationOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["donated", "cancelled"]
    organization_id: UUID | None = None
    reported_quantity: float | None = Field(default=None, gt=0, le=1_000_000)
    donated_at: date | None = None


class DonationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Literal["unsafe_food", "misleading", "other"]
    details: str | None = Field(default=None, max_length=1000)
