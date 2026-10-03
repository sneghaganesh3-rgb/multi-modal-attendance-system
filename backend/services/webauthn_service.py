"""
Fingerprint service — WebAuthn (platform authenticator).

Uses the fingerprint sensor built into the device the browser runs on
(Windows Hello, Touch ID, Android fingerprint). No external scanner/SDK.
If the device has no sensor the browser reports it and the UI says so.

Flow
  enroll : server challenge -> navigator.credentials.create -> verify_registration
  verify : server challenge -> navigator.credentials.get    -> verify_assertion
The server never sees the fingerprint; it stores the credential id and public
key, and checks the signature the device produces after a successful scan.
"""

import base64
import hashlib
import json
import os
import secrets
import threading
import time
from typing import Optional
from urllib.parse import urlparse

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa

CHALLENGE_TTL_SECONDS = 120

# Origins the browser may report in clientDataJSON (the frontend URL(s)).
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    ).split(",") if o.strip()
]

_challenges: dict[str, float] = {}
_lock = threading.Lock()


class WebAuthnError(ValueError):
    pass


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(data: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except Exception:
        raise WebAuthnError("Malformed base64 data")


def new_challenge() -> str:
    """Issue a single-use random challenge (base64url)."""
    challenge = b64url_encode(secrets.token_bytes(32))
    now = time.time()
    with _lock:
        for k in [k for k, exp in _challenges.items() if exp < now]:
            del _challenges[k]
        _challenges[challenge] = now + CHALLENGE_TTL_SECONDS
    return challenge


def _consume_challenge(challenge: str) -> None:
    with _lock:
        expires = _challenges.pop(challenge, None)
    if expires is None or expires < time.time():
        raise WebAuthnError("Fingerprint challenge expired or invalid. Please try again.")


def _check_client_data(client_data_json: bytes, expected_type: str) -> str:
    """Validate clientDataJSON; returns the origin's hostname (the RP id)."""
    try:
        data = json.loads(client_data_json)
    except Exception:
        raise WebAuthnError("Malformed client data")
    if data.get("type") != expected_type:
        raise WebAuthnError("Unexpected WebAuthn operation type")
    _consume_challenge(data.get("challenge", ""))
    origin = data.get("origin", "")
    if origin not in ALLOWED_ORIGINS:
        raise WebAuthnError(f"Origin '{origin}' is not allowed")
    return urlparse(origin).hostname


def _load_public_key(public_key_b64: str):
    try:
        return serialization.load_der_public_key(b64url_decode(public_key_b64))
    except WebAuthnError:
        raise
    except Exception:
        raise WebAuthnError("Invalid public key")


def verify_registration(client_data_json_b64: str, public_key_b64: str) -> None:
    """Check an enrollment response (type, challenge, origin, key validity)."""
    _check_client_data(b64url_decode(client_data_json_b64), "webauthn.create")
    key = _load_public_key(public_key_b64)
    if not isinstance(key, (ec.EllipticCurvePublicKey, rsa.RSAPublicKey)):
        raise WebAuthnError("Unsupported key type")


def verify_assertion(
    template: dict,
    authenticator_data_b64: str,
    client_data_json_b64: str,
    signature_b64: str,
) -> int:
    """
    Verify a scan against a stored template {credential_id, public_key, sign_count}.
    Returns the new signature counter. Raises WebAuthnError on any failure.
    """
    client_data_json = b64url_decode(client_data_json_b64)
    auth_data = b64url_decode(authenticator_data_b64)
    signature = b64url_decode(signature_b64)

    rp_id = _check_client_data(client_data_json, "webauthn.get")

    if len(auth_data) < 37:
        raise WebAuthnError("Malformed authenticator data")
    if auth_data[:32] != hashlib.sha256(rp_id.encode()).digest():
        raise WebAuthnError("Relying party mismatch")
    flags = auth_data[32]
    if not flags & 0x01:
        raise WebAuthnError("User presence not confirmed")
    if not flags & 0x04:
        raise WebAuthnError("Fingerprint (user verification) was not performed")

    sign_count = int.from_bytes(auth_data[33:37], "big")
    stored_count = int(template.get("sign_count", 0))
    if (sign_count or stored_count) and sign_count <= stored_count:
        raise WebAuthnError("Replayed or cloned authenticator detected")

    signed = auth_data + hashlib.sha256(client_data_json).digest()
    key = _load_public_key(template["public_key"])
    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(signature, signed, ec.ECDSA(hashes.SHA256()))
        elif isinstance(key, rsa.RSAPublicKey):
            key.verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())
        else:
            raise WebAuthnError("Unsupported key type")
    except InvalidSignature:
        raise WebAuthnError("Fingerprint signature check failed")
    return sign_count


def parse_template(raw: str) -> Optional[dict]:
    """Stored template -> dict, or None for legacy/invalid rows."""
    try:
        t = json.loads(raw)
        if isinstance(t, dict) and t.get("credential_id") and t.get("public_key"):
            return t
    except Exception:
        pass
    return None
