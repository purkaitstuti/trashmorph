import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import dashboard, listings, marketplace, notifications
from app.core.config import get_settings
from app.api.routes import contact, health, profiles

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("trashmorph")


def create_app() -> FastAPI:
    settings = get_settings()
    docs = None if settings.environment == "production" else "/docs"
    app = FastAPI(title="TRASHMORPH API", version="0.1.0", docs_url=docs, redoc_url=None, openapi_url="/openapi.json" if docs else None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,  # bearer tokens in headers, no cookies
    )

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.error("unhandled error: %s", type(exc).__name__)
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    app.include_router(health.router)
    app.include_router(profiles.router)
    app.include_router(contact.router)
    app.include_router(listings.router)
    app.include_router(marketplace.router)
    app.include_router(notifications.router)
    app.include_router(dashboard.router)
    return app


app = create_app()
