from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

T = TypeVar("T")
Category = Literal["plastic", "paper", "cardboard", "glass", "metal", "organic", "electronic", "textile", "general", "other"]
Unit = Literal["kg", "g", "items", "litres", "boxes", "bags"]
Condition = Literal["like_new", "good", "fair", "scrap"]
ListingType = Literal["free", "exchange", "price"]
Status = Literal["draft", "active", "reserved", "collected", "completed", "cancelled"]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class Listing(BaseModel):
    id: str
    owner_id: str
    title: str
    description: str | None = None
    category: str
    quantity: float
    unit: str
    condition: str
    listing_type: str
    price: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_label: str
    status: str
    images: list[str] = []
    created_at: str
    updated_at: str


class Seller(BaseModel):
    id: str
    full_name: str | None = None
    avatar_url: str | None = None


class ListingDetail(Listing):
    seller: Seller | None = None
    is_owner: bool = False
    is_favorite: bool = False
    has_inquired: bool = False


class _Fields(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListingCreate(_Fields):
    title: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    category: Category
    quantity: float = Field(gt=0, le=1_000_000)
    unit: Unit
    condition: Condition
    listing_type: ListingType
    price: float | None = Field(default=None, ge=0, le=1_000_000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_label: str = Field(min_length=2, max_length=120)
    images: list[str] = Field(default_factory=list, max_length=5)
    status: Literal["draft", "active"] = "active"

    @model_validator(mode="after")
    def _consistent(self):
        if self.listing_type == "price" and self.price is None:
            raise ValueError("price is required for priced listings")
        if self.listing_type != "price":
            self.price = None
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be given together")
        return self


class ListingUpdate(_Fields):
    title: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    category: Category | None = None
    quantity: float | None = Field(default=None, gt=0, le=1_000_000)
    unit: Unit | None = None
    condition: Condition | None = None
    listing_type: ListingType | None = None
    price: float | None = Field(default=None, ge=0, le=1_000_000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_label: str | None = Field(default=None, min_length=2, max_length=120)
    images: list[str] | None = Field(default=None, max_length=5)


class StatusChange(_Fields):
    status: Status


class InquiryIn(_Fields):
    message: str = Field(min_length=10, max_length=1000)
    reply_contact: str | None = Field(default=None, max_length=120)


class Inquiry(BaseModel):
    id: str
    listing_id: str
    listing_title: str
    other_party_name: str | None = None
    message: str
    reply_contact: str | None = None
    status: str
    created_at: str


class ReportIn(_Fields):
    reason: Literal["spam", "unsafe", "misleading", "prohibited", "other"]
    details: str | None = Field(default=None, max_length=500)


class Notification(BaseModel):
    id: str
    title: str
    message: str
    notification_type: str
    reference_id: str | None = None
    read_at: str | None = None
    created_at: str
