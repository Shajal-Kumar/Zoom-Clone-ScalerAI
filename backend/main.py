"""FastAPI application entry point.

Run from the ``backend/`` directory with a SINGLE worker (meeting rooms are
held in process memory)::

    uvicorn main:app --reload --port 8000
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings
from database import SessionLocal, engine, get_db, init_db
from routes import meetings, ws
from seed import seed_database
from websocket_manager import ConnectionManager

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s: %(message)s")
logger = logging.getLogger("zoom_clone")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup
    init_db()
    if settings.seed_on_startup:
        with SessionLocal() as db:
            created = seed_database(db)
        if any(created.values()):
            logger.info("Seeded demo data: %s", created)
    app.state.connection_manager = ConnectionManager()
    logger.info("%s ready.", settings.app_name)

    yield

    # Shutdown: close sockets and cancel grace timers before the DB goes away.
    await app.state.connection_manager.close_all()
    engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meetings.router)
app.include_router(ws.router)


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    return {"name": settings.app_name, "version": settings.app_version, "docs": "/docs"}


@app.get("/health", tags=["meta"])
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """Liveness check that also verifies the database is reachable."""
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
