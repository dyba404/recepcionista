"""Realtime de pedidos: WS /ws/orders?token=<jwt> (ADR 0002).

Los endpoints HTTP son sync (threadpool), así que broadcast() agenda el envío
en el event loop principal con run_coroutine_threadsafe en vez de bloquearlos.
"""
import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from . import security

router = APIRouter()


class ConnectionManager:
    """Sesiones vivas y fan-out de eventos a todas ellas."""

    def __init__(self) -> None:
        self.active: list[WebSocket] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self) -> None:
        self._loop = asyncio.get_running_loop()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active:
            self.active.remove(websocket)

    def broadcast(self, event: str, data: dict | None = None,
                  key: str = "order") -> None:
        """Envía {"event", key: data} a todas las sesiones; no-op si nadie escucha.

        key: "order" (eventos de pedidos, forma original del ADR 0002) o
        "conversation"/"message" (modulos-mvp). Los snapshots se copian: el
        dict vivo puede seguir mutando en otro hilo.
        """
        loop = self._loop
        if loop is None or not self.active:
            return
        message: dict = {"event": event}
        if data is not None:
            message[key] = dict(data)
        try:
            asyncio.run_coroutine_threadsafe(self._send_all(message), loop)
        except RuntimeError:
            # loop ya cerrado (portal de tests): no queda ninguna sesión viva
            self._loop = None
            self.active.clear()

    async def _send_all(self, message: dict) -> None:
        for websocket in list(self.active):
            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(websocket)


manager = ConnectionManager()


@router.websocket("/ws/orders")
async def ws_orders(websocket: WebSocket, token: str = Query(default="")):
    if not security.decode_token(token):
        # accept antes de close: el cliente recibe el close code 4401 y no un 403 opaco
        await websocket.accept()
        await websocket.close(code=4401)
        return
    manager.bind_loop()
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # keepalive: los mensajes del cliente se ignoran
    except WebSocketDisconnect:
        manager.disconnect(websocket)
