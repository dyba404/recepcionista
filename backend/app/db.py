"""SQLite persistente para usuarios: backend/app.db (única tabla: user).

AUTH_DB_PATH permite apuntar el engine a otro archivo (lo usan los tests).
"""
import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from . import models  # noqa: F401 — registra las tablas en SQLModel.metadata

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
]


def _add_missing_columns() -> None:
    with engine.connect() as conn:
        for tabla, columna, ddl in _COLUMNS:
            cols = [r[1] for r in conn.exec_driver_sql(f"PRAGMA table_info({tabla})")]
            if cols and columna not in cols:
                conn.exec_driver_sql(f"ALTER TABLE {tabla} ADD COLUMN {columna} {ddl}")
                conn.commit()


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def get_session():
    with Session(engine) as session:
        yield session
