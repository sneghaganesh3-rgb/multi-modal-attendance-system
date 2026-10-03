"""
Server-side face liveness (anti-spoofing).

The browser only *guides* the user; everything is decided here, so a client that
skips the on-screen blink check (or calls the API directly with a photo) fails.

Active challenge-response, verified on a short burst of frames:
  1. The server issues a one-time token + a random head-turn direction.
  2. The client records ~2-3 s of frames while the user blinks and turns.
  3. We run MediaPipe FaceMesh on every frame and require
       - exactly one face in every analysed frame,
       - a real blink  (eye aspect ratio drops then recovers),
       - the requested head turn (nose shifts across the face),
       - natural motion (a still photo / frozen video has none),
       - and the face keeps the same identity across the burst (embedding check
         is done by the caller, see attendance router).
  4. Passive per-frame checks (very flat / over-exposed / screen-moire frames)
     are folded into a score; only unambiguous cases are hard failures.

Limits: this stops printed photos, static screen images and simple replays that
cannot blink + turn on demand. A determined attacker with a live deepfake or a
3D mask is out of scope for a webcam-only system.
"""

import base64
import io
import secrets
import threading
import time
from typing import Optional

import cv2
import numpy as np
from PIL import Image

TOKEN_TTL_SECONDS = 90
MIN_FRAMES = 6
MAX_FRAMES = 24
MAX_FRAME_PIXELS = 1280 * 960

# MediaPipe FaceMesh landmark ids
LEFT_EYE = [362, 385, 387, 263, 373, 380]
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
NOSE_TIP, LEFT_CHEEK, RIGHT_CHEEK = 1, 234, 454

# Decision constants
EAR_CLOSED_ABS = 0.20          # eye considered closed below this ...
EAR_CLOSED_REL = 0.72          # ... or below this fraction of the person's open baseline
YAW_TURN_MIN = 0.07            # nose shift (fraction of face width) needed for the turn
YAW_MOTION_MIN = 0.03          # minimum natural head motion over the burst
MIN_VALID_FRAME_RATIO = 0.7    # frames where exactly one face was analysed

_challenges: dict[str, dict] = {}
_lock = threading.Lock()
_mesh = None


class LivenessError(ValueError):
    pass


# ─── Challenge tokens ──────────────────────────────────────────────────────

def new_challenge() -> dict:
    """Issue a single-use liveness challenge."""
    token = secrets.token_urlsafe(24)
    direction = secrets.choice(["left", "right"])
    now = time.time()
    with _lock:
        for k in [k for k, v in _challenges.items() if v["exp"] < now]:
            del _challenges[k]
        _challenges[token] = {"direction": direction, "exp": now + TOKEN_TTL_SECONDS}
    return {
        "token": token,
        "direction": direction,
        "instruction": f"Blink once, then slowly turn your head toward the {direction.upper()} side of the screen.",
        "min_frames": MIN_FRAMES,
    }


def _consume(token: Optional[str]) -> str:
    with _lock:
        c = _challenges.pop(token or "", None)
    if c is None or c["exp"] < time.time():
        raise LivenessError("Liveness challenge expired or invalid. Please try again.")
    return c["direction"]


# ─── Frame analysis ────────────────────────────────────────────────────────

def _get_mesh():
    global _mesh
    if _mesh is None:
        import mediapipe as mp
        _mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2,           # 2 so we can reject "more than one face"
            refine_landmarks=True,
            min_detection_confidence=0.5,
        )
    return _mesh


def decode_frame(data_url: str) -> np.ndarray:
    try:
        raw = data_url.split(",", 1)[1] if data_url.startswith("data:") else data_url
        img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        if img.width * img.height > MAX_FRAME_PIXELS:
            scale = (MAX_FRAME_PIXELS / (img.width * img.height)) ** 0.5
            img = img.resize((int(img.width * scale), int(img.height * scale)))
        return np.array(img)
    except Exception as e:
        raise LivenessError(f"Invalid frame: {e}")


def _ear(pts: np.ndarray, idx: list) -> float:
    p1, p2, p3, p4, p5, p6 = (pts[i] for i in idx)
    a = np.linalg.norm(p2 - p6)
    b = np.linalg.norm(p3 - p5)
    c = np.linalg.norm(p1 - p4)
    return float((a + b) / (2.0 * c + 1e-6))


def _passive_quality(rgb: np.ndarray, pts_px: np.ndarray) -> dict:
    """Cheap per-frame texture statistics on the face crop."""
    x0, y0 = np.clip(pts_px.min(axis=0).astype(int), 0, None)
    x1, y1 = pts_px.max(axis=0).astype(int)
    crop = rgb[y0:y1, x0:x1]
    if crop.size == 0 or min(crop.shape[:2]) < 24:
        return {"sharpness": 0.0, "brightness": 0.0, "moire": 0.0}
    gray = cv2.cvtColor(cv2.resize(crop, (128, 128)), cv2.COLOR_RGB2GRAY)
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Moire / pixel-grid of a screen: sharp periodic peaks in the high-frequency spectrum
    win = np.outer(np.hanning(128), np.hanning(128))
    spec = np.abs(np.fft.fftshift(np.fft.fft2((gray.astype(np.float32) - gray.mean()) * win)))
    yy, xx = np.ogrid[:128, :128]
    band = ((yy - 64) ** 2 + (xx - 64) ** 2) > 24 ** 2
    hf = spec[band]
    moire = float(hf.max() / (np.median(hf) + 1e-6))
    return {"sharpness": sharp, "brightness": float(gray.mean()), "moire": moire}


def analyse_frame(rgb: np.ndarray) -> dict:
    """Per-frame metrics: EAR, yaw, face size, texture. ok=False if not exactly one face."""
    res = _get_mesh().process(rgb)
    faces = res.multi_face_landmarks or []
    if len(faces) != 1:
        return {"ok": False, "faces": len(faces)}
    h, w = rgb.shape[:2]
    pts = np.array([[lm.x, lm.y] for lm in faces[0].landmark], dtype=np.float64)
    ear = (_ear(pts, LEFT_EYE) + _ear(pts, RIGHT_EYE)) / 2.0
    width = pts[RIGHT_CHEEK, 0] - pts[LEFT_CHEEK, 0]
    if abs(width) < 1e-3:
        return {"ok": False, "faces": 1}
    # Nose position relative to the cheek midpoint, as a fraction of face width.
    # Frames are sent exactly as the user saw them (mirrored preview), so
    # "left" = toward the left of the picture = yaw decreases.
    yaw = float((pts[NOSE_TIP, 0] - (pts[LEFT_CHEEK, 0] + pts[RIGHT_CHEEK, 0]) / 2.0) / abs(width))
    quality = _passive_quality(rgb, pts * np.array([w, h]))
    return {"ok": True, "faces": 1, "ear": ear, "yaw": yaw, "face_w": abs(width), **quality}


# ─── Decision (pure function: easy to test) ─────────────────────────────────

def evaluate_liveness(metrics: list, direction: str) -> dict:
    """
    metrics: ordered per-frame dicts from analyse_frame().
    Returns {live, score, checks, reason}.
    """
    total = len(metrics)
    valid = [m for m in metrics if m.get("ok")]
    checks = {"frames": total, "valid_frames": len(valid)}

    def fail(reason: str, **extra) -> dict:
        checks.update(extra)
        return {"live": False, "score": 0.0, "checks": checks, "reason": reason}

    if total < MIN_FRAMES:
        return fail(f"Too few frames ({total}); at least {MIN_FRAMES} are required.")
    multi = sum(1 for m in metrics if m.get("faces", 0) > 1)
    if multi:
        return fail("More than one face was visible during the liveness check.")
    if len(valid) / total < MIN_VALID_FRAME_RATIO:
        return fail("Face was not clearly visible throughout the check. Face the camera in good lighting.")

    ears = np.array([m["ear"] for m in valid])
    yaws = np.array([m["yaw"] for m in valid])

    # ── Blink: closed frame bracketed by open frames ─────────────────────
    open_base = float(np.percentile(ears, 80))
    closed_thr = min(EAR_CLOSED_ABS, open_base * EAR_CLOSED_REL)
    closed = ears < closed_thr
    blink = False
    for i in range(1, len(valid) - 1):
        if closed[i] and (~closed[:i]).any() and (~closed[i + 1:]).any():
            blink = True
            break
    # A face whose eyes stay closed the whole time is not a blink either.
    checks.update(blink=bool(blink), ear_open=round(open_base, 3), ear_min=round(float(ears.min()), 3))
    if not blink:
        return fail("No blink detected. Please blink once while facing the camera.")

    # ── Head turn in the requested direction ─────────────────────────────
    k = max(2, len(yaws) // 5)
    baseline = float(np.median(yaws[:k]))
    shift = float(yaws.min() - baseline) if direction == "left" else float(yaws.max() - baseline)
    shift = -shift if direction == "left" else shift          # make "good" positive
    motion = float(yaws.max() - yaws.min())
    checks.update(turn_ok=bool(shift >= YAW_TURN_MIN), turn_shift=round(shift, 3), motion=round(motion, 3))
    if motion < YAW_MOTION_MIN:
        return fail("No natural head movement detected (still image?).")
    if shift < YAW_TURN_MIN:
        return fail(f"Head turn toward the {direction.upper()} was not detected. Turn your head slowly {direction}.")

    # ── Passive texture (only unambiguous failures are hard) ─────────────
    sharp = float(np.median([m["sharpness"] for m in valid]))
    bright = float(np.median([m["brightness"] for m in valid]))
    moire = float(np.median([m["moire"] for m in valid]))
    checks.update(sharpness=round(sharp, 1), brightness=round(bright, 1), moire=round(moire, 1))
    if bright < 25 or bright > 235:
        return fail("Image is too dark or over-exposed. Improve the lighting.")
    if sharp < 8:
        return fail("Image is too blurry/flat for a reliable liveness check.")

    # Soft score: how convincingly the challenge was performed (0-1)
    score = 0.5 * min(1.0, shift / (YAW_TURN_MIN * 2)) + 0.3 * min(1.0, motion / 0.12) + 0.2 * min(1.0, sharp / 60)
    score *= 0.6 if moire > 60 else 1.0     # strong periodic pattern => likely a screen
    return {"live": True, "score": round(float(min(1.0, score)), 3), "checks": checks, "reason": "Liveness confirmed"}


def check_liveness(frames: list, token: str) -> dict:
    """Validate a burst of data-URL frames against the issued challenge."""
    if not frames:
        raise LivenessError("No liveness frames were provided.")
    direction = _consume(token)
    frames = frames[:MAX_FRAMES]
    metrics = [analyse_frame(decode_frame(f)) for f in frames]
    result = evaluate_liveness(metrics, direction)
    result["direction"] = direction
    if result["live"]:
        result.update(_pick_frames(metrics))
    return result


def _pick_frames(metrics: list) -> dict:
    """Indices of the frames to use for identity: best (frontal, eyes open) + first + last."""
    valid = [i for i, m in enumerate(metrics) if m.get("ok")]
    ears = np.array([metrics[i]["ear"] for i in valid])
    open_base = float(np.percentile(ears, 80))
    k = max(2, len(valid) // 5)
    baseline = float(np.median([metrics[i]["yaw"] for i in valid[:k]]))
    candidates = [i for i in valid if metrics[i]["ear"] >= 0.85 * open_base] or valid
    best = min(candidates, key=lambda i: abs(metrics[i]["yaw"] - baseline))
    return {"best_index": best, "sample_indices": sorted({valid[0], best, valid[-1]})}
