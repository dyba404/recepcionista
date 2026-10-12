"""Paquete backend: carga backend/.env al importar (python-dotenv).

Importar app.main (o cualquier app.*) pasa por aquí primero, así las
credenciales Meta/WhatsApp y AUTH_SECRET están en os.environ antes de que
security.py/db.py los lean. override=False: una variable ya presente en el
entorno (p.ej. AUTH_DB_PATH de los tests) SIEMPRE gana al .env.
"""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
