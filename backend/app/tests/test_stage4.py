import io
from datetime import date

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.routes import waste as waste_module
from app.api.routes.analytics import counts, monday, week_starts, weekly
from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, get_current_user
from app.main import app
from app.ml.classifier import ModelUnavailable, Prediction, build_result, map_label
from app.ml.guidance import GUIDANCE
from app.ml.images import validate_image
from app.services import supabase_rest

USER = CurrentUser("u1", "a@b.co", "tok")


def img_bytes(fmt="PNG", size=(32, 32)):
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 120, 60)).save(buf, fmt)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def setup():
    waste_module._hits.clear()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_settings] = lambda: Settings(supabase_url="https://x.supabase.co", min_confidence=0.6, scans_per_minute=3, max_upload_size_mb=1)
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


class FakeClassifier:
    version = "test-1"

    def __init__(self, preds):
        self.preds = preds

    def predict(self, data):
        return self.preds


def fake_backend(monkeypatch, preds):
    calls = []
    monkeypatch.setattr(waste_module, "get_classifier", lambda s: FakeClassifier(preds))

    async def rest(method, table, token, **kw):
        calls.append((method, table, kw))
        return [{"id": "scan-1"}]

    async def upload(token, bucket, path, data, ct):
        calls.append(("UPLOAD", bucket, path))

    monkeypatch.setattr(supabase_rest, "rest", rest)
    monkeypatch.setattr(supabase_rest, "storage_upload", upload)
    return calls


def post(data, name="a.png", ct="image/png", **form):
    return client.post("/api/v1/waste/classify", files={"file": (name, data, ct)}, data=form)


# ── validation ──
@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_valid_formats_pass(fmt):
    assert validate_image(img_bytes(fmt)).ext in {"png", "jpg", "webp"}


def test_rejects_non_images_even_with_image_name(monkeypatch):
    fake_backend(monkeypatch, [Prediction("glass", 0.9)])
    assert post(b"<html>not an image</html>", name="evil.jpg", ct="image/jpeg").status_code == 415


def test_rejects_other_image_formats():
    buf = io.BytesIO(); Image.new("RGB", (8, 8)).save(buf, "GIF")
    with pytest.raises(Exception) as e:
        validate_image(buf.getvalue())
    assert getattr(e.value, "status_code", None) == 415


def test_rejects_oversized_and_empty(monkeypatch):
    fake_backend(monkeypatch, [Prediction("glass", 0.9)])
    assert post(b"x" * (1024 * 1024 + 10)).status_code == 413
    assert post(b"").status_code == 422


def test_rejects_huge_dimensions():
    from app.ml import images
    from unittest import mock
    with mock.patch.object(images, "MAX_PIXELS", 100):
        with pytest.raises(Exception) as e:
            validate_image(img_bytes(size=(50, 50)))
    assert getattr(e.value, "status_code", None) == 422


# ── auth, availability, rate limit ──
def test_classify_requires_auth():
    app.dependency_overrides.pop(get_current_user)
    assert client.post("/api/v1/waste/classify", files={"file": ("a.png", img_bytes(), "image/png")}).status_code == 401


def test_unavailable_model_gives_503_not_a_fake_result(monkeypatch):
    def boom(settings):
        raise ModelUnavailable("not_configured", "The scanner isn't set up yet.")

    monkeypatch.setattr(waste_module, "get_classifier", boom)
    r = post(img_bytes())
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]
    s = client.get("/api/v1/waste/status").json()
    assert s["available"] is False and s["reason"] == "not_configured"


def test_no_model_path_means_not_configured():
    assert client.get("/api/v1/waste/status").json()["reason"] == "not_configured"


def test_rate_limit(monkeypatch):
    fake_backend(monkeypatch, [Prediction("glass", 0.9)])
    codes = [post(img_bytes()).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


# ── results ──
def test_confident_result_is_saved_for_the_token_user(monkeypatch):
    calls = fake_backend(monkeypatch, [Prediction("glass", 0.93), Prediction("plastic", 0.05), Prediction("metal", 0.02)])
    r = post(img_bytes())
    assert r.status_code == 200
    body = r.json()
    assert body["category"] == "glass" and body["is_uncertain"] is False and body["image_saved"] is True and body["scan_id"] == "scan-1"
    assert "can be wrong" in body["disclaimer"]
    insert = [c for c in calls if c[0] == "POST"][0][2]["json"]
    assert insert["user_id"] == "u1" and insert["image_path"].startswith("u1/")


def test_low_confidence_is_reported_uncertain(monkeypatch):
    fake_backend(monkeypatch, [Prediction("glass", 0.41), Prediction("plastic", 0.35)])
    body = post(img_bytes()).json()
    assert body["category"] == "uncertain" and body["is_uncertain"] is True and body["top_guess"] == "glass"


def test_can_skip_saving_the_photo(monkeypatch):
    calls = fake_backend(monkeypatch, [Prediction("paper", 0.9)])
    body = post(img_bytes(), save_image="false").json()
    assert body["image_saved"] is False
    assert not any(c[0] == "UPLOAD" for c in calls)
    assert [c for c in calls if c[0] == "POST"][0][2]["json"]["image_path"] is None


def test_build_result_and_mapping():
    assert map_label("Trash") == "general" and map_label("e-waste") == "electronic" and map_label("battery") == "other"
    r = build_result([Prediction("cardboard", 0.7)], 0.6)
    assert r["category"] == "cardboard" and len(r["alternatives"]) == 1
    assert all(c in GUIDANCE for c in ["plastic", "paper", "cardboard", "glass", "metal", "organic", "electronic", "textile", "general", "other", "uncertain"])


def test_delete_scan_only_own(monkeypatch):
    async def rest(method, table, token, **kw):
        return []
    monkeypatch.setattr(supabase_rest, "rest", rest)
    assert client.delete("/api/v1/waste/scans/11111111-1111-1111-1111-111111111111").status_code == 404


# ── analytics ──
def test_week_helpers():
    assert monday(date(2026, 10, 24)) == date(2026, 10, 19)
    assert [w.isoformat() for w in week_starts(date(2026, 10, 1), date(2026, 10, 20))] == ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]


def test_weekly_buckets_fill_gaps_and_sum_weights():
    rows = [{"created_at": "2026-10-05T10:00:00+00:00", "points": 5}, {"created_at": "2026-10-07T10:00:00Z", "points": 20}, {"created_at": "2026-10-21T00:00:00Z", "points": 5}]
    out = weekly(rows, date(2026, 10, 1), date(2026, 10, 24), weight="points")
    assert {w["week"]: w["value"] for w in out} == {"2026-09-28": 0, "2026-10-05": 25, "2026-10-12": 0, "2026-10-19": 5}
    assert counts([{"k": "a"}, {"k": "b"}, {"k": "a"}], "k") == [{"key": "a", "count": 2}, {"key": "b", "count": 1}]


def test_analytics_validation_and_isolation(monkeypatch):
    assert client.get("/api/v1/analytics?from=2026-10-10&to=2026-10-01").status_code == 422
    assert client.get("/api/v1/analytics?from=2020-01-01&to=2026-10-01").status_code == 422
    assert client.get("/api/v1/analytics?category=plutonium").status_code == 422
    seen = []

    async def rest_list(table, token, **kw):
        seen.append((table, kw["params"]))
        return [], 0

    monkeypatch.setattr(supabase_rest, "rest_list", rest_list)
    r = client.get("/api/v1/analytics?from=2026-10-01&to=2026-10-24")
    assert r.status_code == 200 and r.json()["totals"]["listings"] == 0 and r.json()["truncated"] is False
    owner_filters = {t: dict(p) for t, p in seen}
    assert owner_filters["waste_listings"]["owner_id"] == "eq.u1"
    assert owner_filters["greenscore_transactions"]["user_id"] == "eq.u1"
    assert "u1" in owner_filters["collection_requests"]["or"]


def test_analytics_requires_auth():
    app.dependency_overrides.pop(get_current_user)
    assert client.get("/api/v1/analytics").status_code == 401
