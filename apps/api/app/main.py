from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
import socketio

from app.core.config import get_settings
from app.core.database import connect_db, close_db
from app.core.database_redis import connect_redis, close_redis
from app.core.socket import sio
from app.routers import auth, creators, calls, wallet, admin, misc
from app.services import call_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voxora")


async def _sweeper_loop():
    while True:
        try:
            n = await call_service.sweep_stuck_calls()
            if n:
                logger.info("Swept %s stuck calls", n)
        except Exception:
            logger.exception("sweeper error")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    try:
        await connect_redis()
    except Exception:
        logger.warning("Redis unavailable at startup — presence/locks degraded until Redis is up")
    task = asyncio.create_task(_sweeper_loop())
    logger.info("Voxora API started")
    yield
    task.cancel()
    try:
        await close_redis()
    except Exception:
        pass
    await close_db()


settings = get_settings()
app = FastAPI(title="Voxora API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(creators.router)
api_router.include_router(calls.router)
api_router.include_router(wallet.router)
api_router.include_router(admin.router)
api_router.include_router(misc.router)
app.include_router(api_router)

socket_app = socketio.ASGIApp(sio, other_asgi_app=app)
