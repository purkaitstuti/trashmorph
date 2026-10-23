"""Verify Supabase access tokens. Identity always comes from the verified token, never from the client."""
import logging
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.core.config import Settings, get_settings

log = logging.getLogger("trashmorph.auth")
bearer = HTTPBearer(auto_error=False)
ASYMMETRIC = ["ES256", "RS256"]


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    token: str  # forwarded to PostgREST so Row-Level Security applies as this user


@lru_cache
def _jwks_client(url: str) -> PyJWKClient:
    return PyJWKClient(url, cache_keys=True, lifespan=3600)


def decode_token(token: str, settings: Settings) -> dict:
    alg = jwt.get_unverified_header(token).get("alg")
    common = {"audience": "authenticated", "issuer": settings.issuer, "options": {"require": ["exp", "sub"]}}
    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 not enabled")
        return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], **common)
    if alg in ASYMMETRIC:
        key = _jwks_client(settings.jwks_url).get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=ASYMMETRIC, **common)
    raise jwt.InvalidTokenError("unsupported algorithm")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        claims = decode_token(creds.credentials, settings)
    except (jwt.PyJWTError, jwt.exceptions.PyJWKClientError) as exc:
        log.info("token rejected: %s", type(exc).__name__)
        raise unauthorized from None
    return CurrentUser(id=claims["sub"], email=claims.get("email"), token=creds.credentials)


def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> CurrentUser | None:
    """For public endpoints: anonymous is fine, but a supplied token must be valid."""
    if creds is None:
        return None
    return get_current_user(creds, settings)
