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


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
