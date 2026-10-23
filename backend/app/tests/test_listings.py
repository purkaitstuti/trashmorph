import pytest
from fastapi.testclient import TestClient

from app.api.routes import listings as listings_module
from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, get_current_user, get_optional_user
from app.main import app
from app.services import supabase_rest

URL = "https://example.supabase.co"
LID = "11111111-1111-1111-1111-111111111111"
USER = CurrentUser("u1", "a@b.co", "tok")


def listing(**over):
    base = {"id": LID, "owner_id": "u1", "title": "Glass jars", "description": None, "category": "glass", "quantity": 10, "unit": "items",
            "condition": "good", "listing_type": "free", "price": None, "latitude": None, "longitude": None, "location_label": "Kolkata",
            "status": "active", "images": [], "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}
    return {**base, **over}


VALID = {"title": "Glass jars", "category": "glass", "quantity": 10, "unit": "items", "condition": "good", "listing_type": "free", "location_label": "Kolkata"}


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    s = Settings(supabase_url=URL)
    app.dependency_overrides[get_settings] = lambda: s
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_optional_user] = lambda: USER
    monkeypatch.setattr(listings_module, "get_settings", lambda: s)
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def fake(monkeypatch, **by_method):
    calls = []

    async def fake_rest(method, table, token, **kw):
        calls.append((method, table, kw))
        return by_method.get(method)

    async def fake_list(table, token, **kw):
        calls.append(("LIST", table, kw))
        return by_method.get("LIST", []), len(by_method.get("LIST", []))

    monkeypatch.setattr(supabase_rest, "rest", fake_rest)
    monkeypatch.setattr(supabase_rest, "rest_list", fake_list)
    return calls


def test_clean_search_removes_filter_syntax():
    assert listings_module.clean_search("a,b)(*%\\x") == "abx"


def test_priced_listing_requires_price():
    assert client.post("/api/v1/listings", json={**VALID, "listing_type": "price"}).status_code == 422


def test_rejects_foreign_image_urls():
    r = client.post("/api/v1/listings", json={**VALID, "images": ["https://evil.example/x.jpg"]})
    assert r.status_code == 422


def test_create_sets_owner_from_token_not_body(monkeypatch):
    calls = fake(monkeypatch, POST=[listing()])
    own = f"{URL}/storage/v1/object/public/listing-images/u1/a.jpg"
    r = client.post("/api/v1/listings", json={**VALID, "images": [own]})
    assert r.status_code == 201
    assert calls[0][2]["json"]["owner_id"] == "u1"
    assert client.post("/api/v1/listings", json={**VALID, "owner_id": "someone-else"}).status_code == 422


def test_invalid_uuid_is_rejected():
    assert client.get("/api/v1/listings/not-a-uuid").status_code == 422


def test_page_size_is_capped():
    assert client.get("/api/v1/listings?page_size=500").status_code == 422


def test_invalid_status_transition_conflicts(monkeypatch):
    fake(monkeypatch, GET=[listing(status="completed")])
    assert client.post(f"/api/v1/listings/{LID}/status", json={"status": "active"}).status_code == 409


def test_valid_status_transition(monkeypatch):
    calls = fake(monkeypatch, GET=[listing(status="active")], PATCH=[listing(status="reserved")])
    r = client.post(f"/api/v1/listings/{LID}/status", json={"status": "reserved"})
    assert r.status_code == 200 and r.json()["status"] == "reserved"
    assert calls[-1][2]["params"]["owner_id"] == "eq.u1"


def test_cannot_edit_reserved_listing(monkeypatch):
    fake(monkeypatch, GET=[listing(status="reserved")])
    assert client.patch(f"/api/v1/listings/{LID}", json={"title": "New title"}).status_code == 409


def test_cannot_delete_active_listing(monkeypatch):
    fake(monkeypatch, GET=[listing(status="active")])
    assert client.delete(f"/api/v1/listings/{LID}").status_code == 409


def test_can_delete_draft(monkeypatch):
    fake(monkeypatch, GET=[listing(status="draft")], DELETE=[])
    assert client.delete(f"/api/v1/listings/{LID}").status_code == 204


def test_other_users_listing_is_not_found_for_edit(monkeypatch):
    fake(monkeypatch, GET=[])
    assert client.patch(f"/api/v1/listings/{LID}", json={"title": "New title"}).status_code == 404


def test_cannot_inquire_about_own_listing(monkeypatch):
    fake(monkeypatch, GET=[{"id": LID, "owner_id": "u1", "status": "active"}])
    r = client.post(f"/api/v1/listings/{LID}/inquiries", json={"message": "Is this still available?"})
    assert r.status_code == 400


def test_inquiry_uses_token_identity_and_listing_owner(monkeypatch):
    calls = fake(monkeypatch, GET=[{"id": LID, "owner_id": "seller", "status": "active"}], POST=[{}])
    r = client.post(f"/api/v1/listings/{LID}/inquiries", json={"message": "Is this still available?"})
    assert r.status_code == 201
    sent = calls[-1][2]["json"]
    assert sent["sender_id"] == "u1" and sent["recipient_id"] == "seller"


def test_notifications_only_touch_own_rows(monkeypatch):
    calls = fake(monkeypatch, PATCH=[{"id": LID}])
    assert client.post(f"/api/v1/notifications/{LID}/read").status_code == 204
    assert calls[-1][2]["params"]["user_id"] == "eq.u1"
    fake(monkeypatch, PATCH=[])
    assert client.post(f"/api/v1/notifications/{LID}/read").status_code == 404
