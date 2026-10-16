import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.llm.providers import get_router
from app.services.bootstrap import start_background_bootstrap
from app.services.storage import init_db

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    start_background_bootstrap()
    warm_up = asyncio.create_task(get_router().warm_up())
    yield
    warm_up.cancel()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)

app.include_router(router)


@app.get("/", include_in_schema=False)
def root():
    return {"service": settings.app_name, "status": "ok", "docs": "/docs", "health": "/api/health"}
