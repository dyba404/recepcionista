"""SQLite persistente para usuarios: backend/app.db (única tabla: user).

AUTH_DB_PATH permite apuntar el engine a otro archivo (lo usan los tests).
"""
import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine, select

from . import crypto, models  # noqa: F401 — registra las tablas en SQLModel.metadata

DB_PATH = Path(os.environ.get("AUTH_DB_PATH")
               or Path(__file__).resolve().parent.parent / "app.db")

# un solo archivo sqlite compartido entre hilos del threadpool de FastAPI
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


# Migración mínima columna-a-columna (carta-inventario-bot): create_all NO
# toca tablas ya creadas, así que una BD preexistente no tendría menuitem.stock
# y el primer SELECT del espejo reventaría ("no such column"). Las tablas
# NUEVAS (knowledge_entry, bot_config) las crea create_all; las columnas
# nuevas de tablas VIEJAS entran por ALTER TABLE si faltan.
_COLUMNS = [
    # (tabla, columna, DDL del ALTER)
    ("menuitem", "stock", "INTEGER"),
    # horarios-pausa-notif-perfil: pausa del bot en la fila del Asistente
    ("botconfig", "pausado", "BOOLEAN NOT NULL DEFAULT 0"),
    # endurecer-local (E): plan del SaaS. El default del ALTER es "trial"
    # (el del contrato); los 3 locales demo del .env preexistente quedan en
    # "basico" con el fixup idempotente de seed.run().
    ("tenant", "plan", "VARCHAR NOT NULL DEFAULT 'trial'"),
    ("tenant", "trial_hasta", "DATETIME"),
]


def _add_missing_columns() -> None:
    with engine.connect() as conn:
        for tabla, columna, ddl in _COLUMNS:
            cols = [r[1] for r in conn.exec_driver_sql(f"PRAGMA table_info({tabla})")]
            if cols and columna not in cols:
                conn.exec_driver_sql(f"ALTER TABLE {tabla} ADD COLUMN {columna} {ddl}")
                conn.commit()


def recifrar_plaintext() -> None:
    """Migración perezosa del cifrado (endurecer-local B), AL ARRANQUE:
    re-cifra las filas plaintext que existan de payment_account y
    whatsapp_channel — las que NO arrancan con el prefijo "gAAA" de Fernet.
    Idempotente: lo que ya está cifrado no se toca. Nada se loggea (el
    valor es un secreto)."""
    with Session(engine) as session:
        for row in session.exec(select(models.PaymentAccount)).all():
            if not row.secret_key.startswith(crypto.FERNET_PREFIX):
                row.secret_key = crypto.cifrar(row.secret_key)
                session.add(row)
        for row in session.exec(select(models.WhatsAppChannel)).all():
            if not row.token.startswith(crypto.FERNET_PREFIX):
                row.token = crypto.cifrar(row.token)
                session.add(row)
        session.commit()


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    recifrar_plaintext()  # tras las tablas/columnas: re-cifra lo legado


def get_session():
    with Session(engine) as session:
        yield session
