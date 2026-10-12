"""Reportes CSV (change endurecer-local, contrato A): exportación de
pedidos y ledger para Excel.

- GET /api/reports/pedidos.csv?tenant= (Bearer, manage_orders): TODOS los
  pedidos del local — los que muestra el Panel.
- GET /api/reports/ledger.csv?tenant= (Bearer, view_ledger): los ÚLTIMOS
  100, el mismo límite que GET /api/payments/ledger (el del tooltip).

csv de stdlib con BOM UTF-8 (\ufeff, para que Excel detecte el encoding)
y CRLF (el terminador por defecto de csv.writer). Content-Disposition
attachment con el tenant en el nombre del archivo. Los ítems viajan como
texto humano "2x Ceviche clásico": los nombres salen del espejo data.MENUS
(que es lo mismo que la BD); los ids de pedidos y el created_at salen de la
fila order de SQLite (el espejo en memoria no lleva la fecha).

Interpretación del contrato en los permisos: la ruta pedidos.csv exige
manage_orders (staff lo tiene, como en el avance de pedidos) y ledger.csv
view_ledger (staff NO lo tiene → 403, admin sí). Además check_tenant_owner
en ambas: exportar el local de OTRO es 403 cruzado.
"""
import csv
import io
import json

from fastapi import APIRouter, Depends, Response
from sqlmodel import Session, select

from . import data
from .db import get_session
from .deps import check_tenant_owner
from .models import Order, Payment, User
from .roles import require_perm

router = APIRouter(prefix="/api/reports", tags=["reports"])

# created_at UTC legible en Excel; el CSV no lleva zona (columna de reporte)
FECHA_FMT = "%Y-%m-%d %H:%M"


def _csv_response(nombre_archivo: str, encabezados: list[str],
                 filas: list[list[str]]) -> Response:
    """text/csv + attachment: BOM UTF-8 y CRLF (csv.writer por defecto)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(encabezados)
    w.writerows(filas)
    return Response(content="\ufeff" + buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition":
                             f'attachment; filename="{nombre_archivo}"'})


def _items_texto(tenant: str, items_json: str) -> str:
    """[{"id": "f1", "cant": 2}] → "2x Ceviche clásico; 1x Inca Kola 500ml".
    El nombre sale del espejo data.MENUS; un id desconocido (plato borrado)
    se muestra con su id — el reporte no inventa ni pierde la línea."""
    nombres = {m["id"]: m["nombre"] for m in data.MENUS.get(tenant, [])}
    try:
        items = json.loads(items_json)
    except ValueError:
        return ""
    partes = []
    for it in items:
        iid = it.get("id", "")
        nombre = nombres.get(iid, iid)
        partes.append(f"{it.get('cant', 1)}x {nombre}")
    return "; ".join(partes)


@router.get("/pedidos.csv")
def pedidos_csv(tenant: str,
                user: User = Depends(require_perm("manage_orders")),
                session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)
    rows = session.exec(select(Order).where(Order.tenant_id == tenant)
                        .order_by(Order.created_at.desc())).all()
    filas = [[r.id, r.created_at.strftime(FECHA_FMT), r.cliente,
              _items_texto(tenant, r.items), f"{r.total:.2f}", r.estado,
              r.pago, r.direccion] for r in rows]
    return _csv_response(f"pedidos_{tenant}.csv",
                         ["id", "fecha", "cliente", "items", "total",
                          "estado", "pago", "direccion"], filas)


@router.get("/ledger.csv")
def ledger_csv(tenant: str,
               user: User = Depends(require_perm("view_ledger")),
               session: Session = Depends(get_session)):
    check_tenant_owner(tenant, user)
    rows = session.exec(select(Payment).where(Payment.tenant_id == tenant)
                        .order_by(Payment.id.desc()).limit(100)).all()
    filas = [[r.created_at.strftime(FECHA_FMT), r.gateway, r.referencia,
              f"{r.monto:.2f}", f"{r.comision:.2f}", r.estado, r.order_id,
              r.detalle] for r in rows]
    return _csv_response(f"ledger_{tenant}.csv",
                         ["fecha", "gateway", "referencia", "monto",
                          "comision", "estado", "pedido", "detalle"], filas)
