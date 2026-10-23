import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, get_current_user
from app.main import app
from app.services import supabase_rest

SECRET = "x" * 40
URL = "https://example.supabase.co"


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    s = Settings(supabase_url=URL, supabase_jwt_secret=SECRET, supabase_service_role_key="", cors_origins="http://localhost:5173")
    app.dependency_overrides[get_settings] = lambda: s
    monkeypatch.setattr(supabase_rest, "get_settings", lambda: s)
    yield s
    app.dependency_overrides.clear()


client = TestClient(app)


def make_token(**over):
    claims = {"sub": "user-1", "email": "a@b.co", "aud": "authenticated", "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 600}
    claims.update(over)
    return jwt.encode(claims, SECRET, algorithm="HS256")


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_protected_requires_token():
    assert client.get("/api/v1/profiles/me").status_code == 401


@pytest.mark.parametrize("over", [{"aud": "other"}, {"iss": "https://evil.example/auth/v1"}, {"exp": 1}])
def test_bad_tokens_rejected(over):
    r = client.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {make_token(**over)}"})
    assert r.status_code == 401


def test_unsigned_token_rejected():
    forged = jwt.encode({"sub": "user-1", "aud": "authenticated"}, key=None, algorithm="none")
    assert client.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_valid_token_uses_token_identity(monkeypatch):
    seen = {}

    async def fake_rest(method, table, token, **kw):
        seen.update(params=kw["params"], token=token)
        return [{"id": "user-1", "full_name": "Ana"}]

    monkeypatch.setattr(supabase_rest, "rest", fake_rest)
    t = make_token()
    r = client.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {t}"})
    assert r.status_code == 200 and r.json()["email"] == "a@b.co"
    assert seen["params"]["id"] == "eq.user-1" and seen["token"] == t


def test_profile_update_rejects_role_and_insecure_avatar():
    app.dependency_overrides[get_current_user] = lambda: CurrentUser("u", None, "t")
    assert client.patch("/api/v1/profiles/me", json={"role": "admin"}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"avatar_url": "http://insecure"}).status_code == 422


def test_delete_requires_confirmation():
    app.dependency_overrides[get_current_user] = lambda: CurrentUser("u", None, "t")
    assert client.request("DELETE", "/api/v1/profiles/me", json={}).status_code == 422


def test_contact_validation_and_unconfigured():
    assert client.post("/api/v1/contact", json={"name": "A", "email": "nope", "message": "short"}).status_code == 422
    ok = {"name": "Ana", "email": "ana@example.com", "message": "Hello, this is a real message."}
    # No service-role key configured: must fail honestly, not pretend success.
    assert client.post("/api/v1/contact", json=ok).status_code == 503


def test_cors_allows_only_configured_origin():
    ok = client.options("/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    bad = client.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers
