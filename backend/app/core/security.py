
"""Passwords (PBKDF2 and bcrypt) and sign-in tokens."""
from __future__ import annotations

import hashlib
import secrets

import bcrypt
from passlib.hash import pbkdf2_sha256

from ..config import get_settings


def hash_password(password: str, rounds: int | None = None) -> str:
    salt = bcrypt.gensalt(rounds or get_settings().bcrypt_rounds)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        if password_hash.startswith("$pbkdf2-sha256$"):
            return pbkdf2_sha256.verify(password, password_hash)

        if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
            return bcrypt.checkpw(
                password.encode("utf-8"),
                password_hash.encode("ascii"),
            )

        return False
    except (ValueError, TypeError, UnicodeError):
        return False


def new_token() -> str:
    return secrets.token_hex(24)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
