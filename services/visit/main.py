"""Visit Service: per-user island sessions + DM chat."""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from services.visit.api import router as visit_router
from shared.redis_client import close_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_redis()


app = FastAPI(title="Islume Visit", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "visit"}


app.include_router(visit_router)
