"""Reset del demo sandbox (ex main.py, saas-cola-2)."""
from fastapi import APIRouter, Depends

from . import store, ws
from .deps import get_current_user

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/reset", dependencies=[Depends(get_current_user)])
def reset():
    store.reset_demo()
    ws.manager.broadcast("demo.reset")
    return {"ok": True, "n": len(store.ORDERS)}
