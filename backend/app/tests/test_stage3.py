import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.api.routes.collections import allowed_actions
from app.api.routes.greenscore import POLICY, badges_for, level_for
from app.api.routes.recyclers import haversine_km
from app.core.security import CurrentUser, get_current_user, get_optional_user
from app.main import app
from app.services import supabase_rest

CID = "22222222-2222-2222-2222-222222222222"
LID = "11111111-1111-1111-1111-111111111111"
REQ = CurrentUser("req", None, "t")
OWN = CurrentUser("own", None, "t")


def as_user(u):
    app.dependency_overrides[get_current_user] = lambda: u
    app.dependency_overrides[get_optional_user] = lambda: u


@pytest.fixture(autouse=True)
def cleanup():
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def request_row(status="requested"):
    return {"id": CID, "listing_id": LID, "requester_id": "req", "owner_id": "own", "listing_title": "Jars", "quantity": 2, "requested_date": "2030-01-01",
            "time_window": "any", "instructions": None, "status": status, "created_at": "2030-01-01T00:00:00Z", "updated_at": "2030-01-01T00:00:00Z"}


def fake_db(monkeypatch, status="requested"):
    calls = []

    async def rest(method, table, token, **kw):
        calls.append((method, table, kw))
        if table == "collection_requests":
            return [request_row(status)]
        if table == "collection_status_history":
            return [{"previous_status": None, "new_status": "requested", "changed_by": "req", "created_at": "2030-01-01T00:00:00Z"}]
        if table == "public_profiles":
            return [{"id": "req", "full_name": "Rita"}, {"id": "own", "full_name": "Omar"}]
        return None

    monkeypatch.setattr(supabase_rest, "rest", rest)
    return calls


def test_allowed_actions_by_role():
    assert allowed_actions("requested", "owner") == ["accepted", "rejected"]
    assert allowed_actions("requested", "requester") == ["cancelled"]
    assert allowed_actions("in_progress", "requester") == ["cancelled"]
    assert allowed_actions("in_progress", "owner") == ["completed", "cancelled"]
    assert allowed_actions("completed", "owner") == [] and allowed_actions("rejected", "requester") == []


def test_requester_cannot_accept(monkeypatch):
    as_user(REQ); calls = fake_db(monkeypatch)
    assert client.post(f"/api/v1/collections/{CID}/status", json={"status": "accepted"}).status_code == 403
    assert not any(c[1] == "rpc/change_collection_status" for c in calls)


def test_invalid_transition_conflicts(monkeypatch):
    as_user(OWN); fake_db(monkeypatch, status="completed")
    assert client.post(f"/api/v1/collections/{CID}/status", json={"status": "cancelled"}).status_code == 409


def test_owner_can_accept_via_database_function(monkeypatch):
    as_user(OWN); calls = fake_db(monkeypatch)
    r = client.post(f"/api/v1/collections/{CID}/status", json={"status": "accepted"})
    assert r.status_code == 200 and r.json()["role"] == "owner" and r.json()["other_party_name"] == "Rita"
    rpc = [c for c in calls if c[1] == "rpc/change_collection_status"][0]
    assert rpc[2]["json"] == {"p_request": CID, "p_status": "accepted"}


def test_stranger_gets_404(monkeypatch):
    as_user(CurrentUser("stranger", None, "t")); fake_db(monkeypatch)
    assert client.get(f"/api/v1/collections/{CID}").status_code == 404
    assert client.post(f"/api/v1/collections/{CID}/status", json={"status": "cancelled"}).status_code == 404


def test_create_rejects_past_date_and_unknown_fields():
    as_user(REQ)
    past = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    assert client.post("/api/v1/collections", json={"listing_id": LID, "quantity": 1, "requested_date": past}).status_code == 422
    future = (dt.date.today() + dt.timedelta(days=3)).isoformat()
    assert client.post("/api/v1/collections", json={"listing_id": LID, "quantity": 1, "requested_date": future, "status": "completed"}).status_code == 422


def test_create_sets_requester_from_token(monkeypatch):
    as_user(REQ)
    calls = []
    tables = {"collection_requests": [request_row()], "collection_status_history": [], "public_profiles": []}

    async def rest(method, table, token, **kw):
        calls.append((method, table, kw))
        return [{"id": CID}] if method == "POST" else tables[table]

    monkeypatch.setattr(supabase_rest, "rest", rest)
    future = (dt.date.today() + dt.timedelta(days=3)).isoformat()
    spoofed = client.post("/api/v1/collections", json={"listing_id": LID, "quantity": 1, "requested_date": future, "requester_id": "x"})
    assert spoofed.status_code == 422  # client-supplied identity is refused
    ok = client.post("/api/v1/collections", json={"listing_id": LID, "quantity": 1, "requested_date": future})
    assert ok.status_code == 201
    assert [c for c in calls if c[0] == "POST"][-1][2]["json"]["requester_id"] == "req"


def test_haversine_known_distance():
    assert haversine_km(22.5726, 88.3639, 22.5726, 88.3639) == 0
    assert abs(haversine_km(0, 0, 1, 0) - 111.2) < 0.5  # one degree of latitude


def test_recycler_radius_filter_and_ordering(monkeypatch):
    as_user(None)
    rows = [{"id": str(i), "name": n, "description": None, "accepted_materials": ["glass"], "recycler_type": "recycling_center", "latitude": la, "longitude": 0.0, "address": None,
             "contact_information": None, "source": "admin", "verification_status": "verified", "submitted_by": "someone"} for i, (n, la) in enumerate([("far", 5.0), ("near", 0.1), ("mid", 0.5)])]

    async def rest_list(table, token, **kw):
        return rows, len(rows)

    monkeypatch.setattr(supabase_rest, "rest_list", rest_list)
    r = client.get("/api/v1/recyclers?lat=0&lng=0&radius_km=100")
    names = [i["name"] for i in r.json()["items"]]
    assert names == ["near", "mid"]
    assert all("submitted_by" not in i for i in r.json()["items"])
    assert client.get("/api/v1/recyclers?material=plutonium").status_code == 422


def test_recycler_suggestion_validation():
    as_user(REQ)
    ok = {"name": "Green Point", "accepted_materials": ["glass"], "recycler_type": "recycling_center", "latitude": 22.5, "longitude": 88.3}
    assert client.post("/api/v1/recyclers", json={**ok, "accepted_materials": []}).status_code == 422
    assert client.post("/api/v1/recyclers", json={**ok, "latitude": 200}).status_code == 422
    assert client.post("/api/v1/recyclers", json={**ok, "verification_status": "verified"}).status_code == 422


def test_suggestion_is_always_pending(monkeypatch):
    as_user(REQ); sent = {}

    async def rest(method, table, token, **kw):
        sent.update(kw["json"])

    monkeypatch.setattr(supabase_rest, "rest", rest)
    ok = {"name": "Green Point", "accepted_materials": ["glass"], "recycler_type": "recycling_center", "latitude": 22.5, "longitude": 88.3}
    assert client.post("/api/v1/recyclers", json=ok).status_code == 201
    assert sent["verification_status"] == "pending" and sent["submitted_by"] == "req" and sent["source"] == "user_submitted"


def test_levels_and_badges():
    assert level_for(0)["name"] == "Seedling" and level_for(49)["next_at"] == 50
    assert level_for(150)["name"] == "Sapling" and level_for(9999)["next_name"] is None
    earned = {b["key"] for b in badges_for({"listing_published": 1, "collection_collected": 5}, 120) if b["earned"]}
    assert earned == {"first_listing", "first_handover", "community_helper", "sprout"}


def test_policy_is_positive_and_capped():
    assert all(p["points"] > 0 and p["daily_cap"] > 0 for p in POLICY)


def test_greenscore_requires_auth():
    assert client.get("/api/v1/greenscore").status_code == 401
