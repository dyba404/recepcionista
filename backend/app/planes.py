"""Planes del SaaS (change endurecer-local, contrato E): pricing público y
trial local — el cobro REAL queda pendiente de cuenta externa (Culqi
Suscripciones), así que activar es un guardado simple con nota honesta.

GET /api/planes (público): las 3 cards de la página /planes del frontend.
El PATCH /api/tenants/{id}/plan (owner) vive en tenants.py, junto al local
que cambia de plan; el trial de 14 días se fija en crear_tenant.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/planes", tags=["planes"])

PLANES = [
    {"id": "trial", "nombre": "Prueba", "precio": 0,
     "detalle": "14 días completos"},
    {"id": "basico", "nombre": "Básico", "precio": 49,
     "detalle": "1 local + chatbot + inbox"},
    {"id": "pro", "nombre": "Pro", "precio": 99,
     "detalle": "+ KDS, ledger, plantillas"},
]


@router.get("")
def planes():
    return PLANES
