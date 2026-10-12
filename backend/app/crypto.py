"""Cifrado de secretos en BD (change endurecer-local, contrato B).

Fernet (librería `cryptography`, la ÚNICA dependencia nueva) con la clave
derivada de AUTH_SECRET: sha256 del secreto → base64url (clave válida de 32
bytes para Fernet). PaymentAccount.secret_key y WhatsAppChannel.token se
guardan CIFRADOS y se descifran SOLO en el punto de uso (crear_cargo_culqi,
send_whatsapp); JAMÁS viajan en una respuesta HTTP y NUNCA se loggean.

Tolerancia retro (migración perezosa): descifrar() devuelve el valor TAL
CUAL si no arranca con el prefijo "gAAA" de Fernet — una fila plaintext
legada sigue funcionando y se cifra la próxima vez que se guarda. Al
arrancar, db.recifrar_plaintext() re-cifra en bloque las filas plaintext
que haya (detecta por el mismo prefijo).

Los tokens Fernet empiezan SIEMPRE con "gAAA" (byte de versión 0x80 en
base64): ese prefijo es el detector de "ya está cifrado".
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet

FERNET_PREFIX = "gAAA"


def _fernet() -> Fernet:
    """Fernet con la clave derivada de AUTH_SECRET (sha256 → base64url).

    Se lee al LLAMAR, no al importar: app/__init__ ya cargó el .env antes
    de que cualquier módulo se importe, y así la derivación es igual de
    correcta aunque el import ocurra en otro orden.
    """
    secreto = os.environ.get("AUTH_SECRET", "dev-secret-fixme")
    digest = hashlib.sha256(secreto.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def cifrar(txt: str) -> str:
    """Plaintext → token Fernet ("gAAA…"). Idempotente: un valor que ya
    viene cifrado (o vacío) se devuelve tal cual — jamás doble-cifrado."""
    if not txt or txt.startswith(FERNET_PREFIX):
        return txt
    return _fernet().encrypt(txt.encode()).decode()


def descifrar(txt: str) -> str:
    """Token Fernet → plaintext, TOLERANTE y sin excepciones:

    - vacío o sin prefijo "gAAA" → plaintext legado: tal cual (migración
      perezosa: al re-guardar se cifra).
    - con prefijo pero no abre con la clave actual → tal cual: el punto de
      uso (cargo, envío) NUNCA se rompe por un problema de cifrado.

    NUNCA loggea: el valor es un secreto.
    """
    if not txt or not txt.startswith(FERNET_PREFIX):
        return txt
    try:
        return _fernet().decrypt(txt.encode()).decode()
    except Exception:
        return txt
