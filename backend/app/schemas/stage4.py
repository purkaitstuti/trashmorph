from pydantic import BaseModel


class Alternative(BaseModel):
    label: str
    category: str
    confidence: float


class ScanCandidate(BaseModel):
    candidate_id: str
    region_label: str
    bbox: list[float]
    category: str
    confidence: float
    is_uncertain: bool
    top_guess: str
    suggested_action: str


class ClassifyResult(BaseModel):
    scan_id: str
    category: str
    confidence: float
    is_uncertain: bool
    top_guess: str
    suggested_action: str
    recycling_guidance: str
    alternatives: list[Alternative]
    candidates: list[ScanCandidate]
    model_version: str
    image_saved: bool
    disclaimer: str


class ScanItem(BaseModel):
    id: str
    category: str
    confidence: float
    top_guess: str | None = None
    suggested_action: str
    is_uncertain: bool
    image_url: str | None = None
    created_at: str
