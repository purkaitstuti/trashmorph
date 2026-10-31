from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.security import CurrentUser, get_current_user, get_optional_user
from app.main import app
from app.services import supabase_rest

USER = CurrentUser("food-donor", None, "token")
DONATION_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture(autouse=True)
def auth_overrides():
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_optional_user] = lambda: USER
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def valid_donation():
    now = datetime.now(timezone.utc)
    return {
        "title": "Party meal trays", "donor_type": "individual", "food_category": "prepared_meal", "description": "Vegetarian meals, sealed.",
        "quantity": 12, "unit": "servings", "prepared_at": (now - timedelta(hours=1)).isoformat(),
        "storage_conditions": "Refrigerated since preparation", "allergens": ["milk"],
        "pickup_deadline": (now + timedelta(hours=4)).isoformat(), "location_label": "North Kolkata",
        "latitude": 22.5726, "longitude": 88.3639,
    }


def test_create_donation_uses_authenticated_owner_and_approximate_coordinates(monkeypatch):
    captured = {}

    async def rest(method, table, token, **kwargs):
        captured.update(kwargs["json"])
        return [{"id": DONATION_ID, **kwargs["json"]}]

    monkeypatch.setattr(supabase_rest, "rest", rest)
    response = client.post("/api/v1/food-rescue/donations", json={**valid_donation(), "donor_id": "someone-else"})
    assert response.status_code == 422  # client identity fields are forbidden
    response = client.post("/api/v1/food-rescue/donations", json=valid_donation())
    assert response.status_code == 201
    assert captured["donor_id"] == USER.id
    assert captured["status"] == "available"
    assert captured["verification"] == "not_verified"
    assert captured["latitude"] == 22.57 and captured["longitude"] == 88.36


def test_create_rejects_expired_and_invalid_food_records():
    body = valid_donation()
    body["pickup_deadline"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert client.post("/api/v1/food-rescue/donations", json=body).status_code == 422
    body = valid_donation()
    body["food_category"] = "plastic"
    assert client.post("/api/v1/food-rescue/donations", json=body).status_code == 422
    body = valid_donation()
    body["location_label"] = "12 Main Street, Kolkata"
    assert client.post("/api/v1/food-rescue/donations", json=body).status_code == 422


def test_create_rejects_external_photo_url():
    body = valid_donation()
    body["photo_url"] = "https://example.com/untrusted.jpg"
    assert client.post("/api/v1/food-rescue/donations", json=body).status_code == 422


def test_public_food_list_uses_redacted_public_view(monkeypatch):
    async def rest_list(table, token, **kwargs):
        assert table == "food_donations_public"
        return [{"id": DONATION_ID, "title": "Meal tray", "status": "available"}], 1

    monkeypatch.setattr(supabase_rest, "rest_list", rest_list)
    response = client.get("/api/v1/food-rescue/donations")
    assert response.status_code == 200
    assert "donor_id" not in response.json()["items"][0]


def test_public_food_list_requires_login_for_mine(monkeypatch):
    app.dependency_overrides[get_optional_user] = lambda: None
    assert client.get("/api/v1/food-rescue/donations?mine=true").status_code == 401


def test_organization_directory_includes_review_status(monkeypatch):
    async def rest_list(table, token, **kwargs):
        assert table == "food_rescue_organizations"
        return [{"id": "org-1", "name": "Example group", "organization_type": "ngo", "address": "Kolkata", "latitude": 22.57, "longitude": 88.36,
                 "contact_number": None, "website": None, "operating_hours": None, "donation_requirements": None, "verification_status": "needs_review"}], 1

    monkeypatch.setattr(supabase_rest, "rest_list", rest_list)
    response = client.get("/api/v1/food-rescue/organizations")
    assert response.status_code == 200
    assert response.json()["items"][0]["verification_status"] == "needs_review"
