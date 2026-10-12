"""Seguridad con stdlib puro: hash de contraseñas y JWT HS256 (ADR 0002).

pbkdf2_sha256 (hashlib) y JWT firmado a mano con hmac-sha256: cero dependencias
nativas o de JWT, así funciona igual en Windows sin compiladores.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

SECRET = os.environ.get("AUTH_SECRET", "dev-secret-fixme")
PBKDF2_ITERATIONS = 390_000
TOKEN_TTL = 24 * 60 * 60  # exp 24h


def hash_password(password: str) -> str:
    """Formato "pbkdf2_sha256$iterations$salt$hash", salt aleatorio por usuario."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Comparación en tiempo constante; False ante cualquier formato corrupto."""
    try:
        algo, iterations, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        calculated = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), int(iterations))
        return hmac.compare_digest(calculated, bytes.fromhex(digest))
    except (TypeError, ValueError):
        return False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _sign(payload: bytes) -> bytes:
    return hmac.new(SECRET.encode(), payload, hashlib.sha256).digest()


def create_token(user_id: int, email: str) -> str:
    """JWT HS256: header.payload.signature, todos base64url sin padding."""
    claims = {"sub": str(user_id), "email": email, "exp": int(time.time()) + TOKEN_TTL}
    head = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64url(json.dumps(claims).encode())
    return f"{head}.{body}.{_b64url(_sign(f'{head}.{body}'.encode()))}"


def decode_token(token: str) -> dict | None:
    """Claims si la firma y la expiración son válidas; None ante cualquier error."""
    try:
        head, body, signature = token.split(".")
        if not hmac.compare_digest(_b64url(_sign(f"{head}.{body}".encode())), signature):
            return None
        claims = json.loads(_b64url_decode(body))
        if not isinstance(claims, dict) or claims.get("exp", 0) < time.time():
            return None
        return claims
    except (TypeError, ValueError):
        return None
