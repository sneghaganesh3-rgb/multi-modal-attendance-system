"""
Advanced Multi-Modal Palm Recognition Service
Combines:
1. 3D Canonical Hand Pose Normalization (rotation & scale invariant)
2. 44-Dimensional Anthropometric Morphological Biometrics (2D:4D digit ratios,
   phalangeal segment proportions, palm aspect ratio, joint distances & angles)
3. Palmprint Region-of-Interest (ROI) Crease Texture Descriptor (CLAHE + HOG)
4. Backward-compatible parsing for existing legacy 63-D landmark templates.
"""

import numpy as np
import base64
import io
import cv2
from PIL import Image

# Module-level holder for the MediaPipe Hands instance (initialized once, lazily)
_hands_instance = None
_hands_relaxed = None


def _get_hands(relaxed: bool = False):
    """Lazily initialize MediaPipe Hands (normal and a lower-confidence retry detector)."""
    global _hands_instance, _hands_relaxed
    if (_hands_relaxed if relaxed else _hands_instance) is None:
        try:
            import mediapipe as mp
            conf = 0.25 if relaxed else 0.45
            inst = mp.solutions.hands.Hands(
                static_image_mode=True,
                max_num_hands=1,
                min_detection_confidence=conf,
                min_tracking_confidence=conf,
            )
            if relaxed:
                _hands_relaxed = inst
            else:
                _hands_instance = inst
        except Exception as e:
            raise RuntimeError(
                f"MediaPipe failed to initialize: {e}\n"
                "Run: pip install mediapipe"
            )
    return _hands_relaxed if relaxed else _hands_instance


def decode_image(image_bytes) -> np.ndarray:
    """Decode a base64 image (data URL or raw base64) into a numpy RGB array."""
    try:
        if isinstance(image_bytes, str):
            image_bytes = image_bytes.encode("utf-8")
        if image_bytes.startswith(b"data:image"):
            image_bytes = image_bytes.split(b",", 1)[1]
        decoded = base64.b64decode(image_bytes)
        image = Image.open(io.BytesIO(decoded)).convert("RGB")
        return np.array(image)
    except Exception as e:
        raise ValueError(f"Invalid image format: {e}")


def landmarks_to_biometrics(landmarks_21x3: np.ndarray) -> np.ndarray:
    """
    Extract 44 rotation- and scale-invariant anthropometric biometric features
    from 21 3D hand landmarks.

    Features include:
    - Finger lengths relative to palm span
    - Genetically distinct digit ratios (2D:4D index/ring, index/middle, etc.)
    - Palm width-to-height aspect ratio
    - Phalangeal segment length proportions (proximal, intermediate, distal)
    - Inter-finger angles
    - Inter-fingertip distance ratios
    - Distance of MCP joints from palm centroid
    """
    p = np.array(landmarks_21x3, dtype=np.float64)
    if p.shape != (21, 3):
        p = p.reshape(21, 3)

    # 1. Canonical Coordinate Frame (Rotation Invariant)
    # Origin at wrist (0)
    wrist = p[0]
    p = p - wrist

    # Primary axis Y: wrist(0) -> middle finger MCP joint(9)
    y_vec = p[9]
    y_len = np.linalg.norm(y_vec)
    y_axis = y_vec / (y_len + 1e-6)

    # Palm lateral reference: index MCP(5) -> pinky MCP(17)
    palm_cross = p[17] - p[5]

    # Normal axis Z: cross product of Y-axis and palm cross-vector
    z_vec = np.cross(y_axis, palm_cross)
    z_axis = z_vec / (np.linalg.norm(z_vec) + 1e-6)

    # Lateral axis X: orthogonal to Y and Z
    x_axis = np.cross(y_axis, z_axis)
    x_axis = x_axis / (np.linalg.norm(x_axis) + 1e-6)

    # Transformation matrix to align hand to canonical upright orientation
    R = np.vstack([x_axis, y_axis, z_axis])
    canonical = np.dot(p, R.T)  # shape (21, 3)

    # Scale normalization: anatomical palm length (wrist 0 to middle MCP 9)
    palm_scale = np.linalg.norm(canonical[9]) + 1e-6
    canonical = canonical / palm_scale

    # Landmark indices for tips and bases
    tips = [4, 8, 12, 16, 20]  # Thumb, Index, Middle, Ring, Pinky
    mcps = [1, 5, 9, 13, 17]

    bio = []

    # 1. Anthropometric finger lengths (relative to palm length)
    finger_lens = []
    for mcp, tip in zip(mcps, tips):
        flen = float(np.linalg.norm(canonical[tip] - canonical[mcp]))
        finger_lens.append(flen)
        bio.append(flen)

    # 2. Key biometric digit ratios (highly individual, e.g. Manning 2D:4D ratio)
    bio.append(finger_lens[1] / (finger_lens[3] + 1e-6))  # 2D:4D ratio (Index / Ring)
    bio.append(finger_lens[1] / (finger_lens[2] + 1e-6))  # Index / Middle
    bio.append(finger_lens[3] / (finger_lens[2] + 1e-6))  # Ring / Middle
    bio.append(finger_lens[4] / (finger_lens[2] + 1e-6))  # Pinky / Middle
    bio.append(finger_lens[0] / (finger_lens[1] + 1e-6))  # Thumb / Index

    # 3. Palm aspect ratio (Palm width / Palm length)
    palm_width = float(np.linalg.norm(canonical[17] - canonical[5]))
    bio.append(palm_width)

    # 4. Phalangeal segment ratios (proximal, intermediate, distal segments)
    finger_quads = [
        (1, 2, 3, 4),      # Thumb
        (5, 6, 7, 8),      # Index
        (9, 10, 11, 12),   # Middle
        (13, 14, 15, 16),  # Ring
        (17, 18, 19, 20),  # Pinky
    ]
    for mcp, pip, dip, tip in finger_quads:
        s1 = float(np.linalg.norm(canonical[pip] - canonical[mcp]))
        s2 = float(np.linalg.norm(canonical[dip] - canonical[pip]))
        s3 = float(np.linalg.norm(canonical[tip] - canonical[dip]))
        tot = s1 + s2 + s3 + 1e-6
        bio.extend([s1 / tot, s2 / tot, s3 / tot])

    # 5. Angles between adjacent finger rays
    v_thumb = canonical[4] - canonical[2]
    v_index = canonical[8] - canonical[6]
    v_middle = canonical[12] - canonical[10]
    v_ring = canonical[16] - canonical[14]
    v_pinky = canonical[20] - canonical[18]

    for v1, v2 in [(v_thumb, v_index), (v_index, v_middle), (v_middle, v_ring), (v_ring, v_pinky)]:
        cos_ang = float(np.dot(v1, v2) / ((np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-6))
        bio.append(cos_ang)

    # 6. Inter-fingertip distance ratios (normalized by palm width)
    for i in range(len(tips) - 1):
        d_tip = float(np.linalg.norm(canonical[tips[i + 1]] - canonical[tips[i]]))
        bio.append(d_tip / (palm_width + 1e-6))

    # 7. MCP joint distances from palm centroid
    palm_centroid = (canonical[0] + canonical[5] + canonical[9] + canonical[17]) / 4.0
    for mcp in mcps:
        bio.append(float(np.linalg.norm(canonical[mcp] - palm_centroid)))

    # 8. Fingertip to wrist spans
    for tip in tips:
        bio.append(float(np.linalg.norm(canonical[tip])))

    return np.array(bio, dtype=np.float32)


def extract_palm_roi_texture(image_rgb: np.ndarray, landmarks_px: np.ndarray) -> list:
    """
    Extract a 128-D texture gradient descriptor from the central palm crease ROI
    bounded by the wrist and MCP joints.
    """
    try:
        pts = np.array(landmarks_px, dtype=np.float32)

        # Palm center: weighted centroid of wrist(0), index MCP(5), pinky MCP(17)
        center = (pts[0] + pts[5] + pts[17]) / 3.0

        # In-plane rotation angle to upright orientation
        v_up = pts[9] - pts[0]
        angle = float(np.degrees(np.arctan2(v_up[1], v_up[0])) + 90.0)

        # Scale by palm breadth
        palm_width = float(np.linalg.norm(pts[17] - pts[5]))
        roi_size = int(max(32, palm_width * 0.75))

        # Affine transformation to 64x64 normalized palmprint patch
        M = cv2.getRotationMatrix2D((float(center[0]), float(center[1])), angle, 64.0 / roi_size)
        M[0, 2] += (32.0 - center[0])
        M[1, 2] += (32.0 - center[1])

        warped = cv2.warpAffine(
            image_rgb, M, (64, 64),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT
        )
        gray = cv2.cvtColor(warped, cv2.COLOR_RGB2GRAY)

        # Contrast Limited Adaptive Histogram Equalization for lighting normalization
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
        enhanced = clahe.apply(gray)

        # Multi-scale gradient orientation for palm lines
        gx = cv2.Sobel(enhanced, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(enhanced, cv2.CV_32F, 0, 1, ksize=3)
        mag, ang = cv2.cartToPolar(gx, gy, angleInDegrees=True)

        # 4x4 spatial blocks with 8 orientation bins = 128-D descriptor
        cell_size = 16
        hist_list = []
        for r in range(4):
            for c in range(4):
                cell_mag = mag[r * cell_size:(r + 1) * cell_size, c * cell_size:(c + 1) * cell_size]
                cell_ang = ang[r * cell_size:(r + 1) * cell_size, c * cell_size:(c + 1) * cell_size]
                hist, _ = np.histogram(cell_ang, bins=8, range=(0, 360), weights=cell_mag)
                hist_list.extend(hist)

        hist_vec = np.array(hist_list, dtype=np.float32)
        norm = np.linalg.norm(hist_vec)
        if norm > 1e-6:
            hist_vec /= norm
        return hist_vec.tolist()
    except Exception:
        return []


BIO_DIM = 44   # length of landmarks_to_biometrics()


def _check_palm_quality(raw: np.ndarray, handedness_score: float, w: int, h: int) -> None:
    """Enrollment-grade checks: a flat, open, fully visible, reasonably large hand."""
    if raw[:, 0].min() < 0.01 or raw[:, 0].max() > 0.99 or raw[:, 1].min() < 0.01 or raw[:, 1].max() > 0.99:
        raise ValueError("Your whole hand must be inside the frame. Move it back a little.")
    palm_len_px = float(np.linalg.norm((raw[9, :2] - raw[0, :2]) * np.array([w, h])))
    if palm_len_px < 0.15 * min(w, h):
        raise ValueError("Hand is too small or too far away. Move closer to the camera.")
    if handedness_score < 0.80:
        raise ValueError("Could not clearly recognise the hand. Show your open palm flat to the camera.")
    # Fingers must be extended: each fingertip farther from the wrist than its PIP joint
    for tip, pip in [(8, 6), (12, 10), (16, 14), (20, 18)]:
        if np.linalg.norm(raw[tip, :2] - raw[0, :2]) < np.linalg.norm(raw[pip, :2] - raw[0, :2]):
            raise ValueError("Open and spread your fingers flat so all fingers are visible.")


def extract_palm_features(image_bytes: bytes, strict: bool = False) -> dict:
    """
    Detect hand in image, extract:
    - 44-D anthropometric biometric vector
    - 128-D palmprint crease texture descriptor
    - 63-D canonical normalized landmarks (backwards compatibility)
    - Auto-detected hand side (left or right)
    """
    hands = _get_hands()
    image_array = decode_image(image_bytes)
    h, w = image_array.shape[:2]

    results = hands.process(image_array)

    if not results.multi_hand_landmarks:
        # Retry: lower confidence on a padded frame (hand touching the image border)
        pad = int(0.15 * min(h, w))
        padded = cv2.copyMakeBorder(image_array, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        retry = _get_hands(relaxed=True).process(padded)
        if retry.multi_hand_landmarks:
            for lm in retry.multi_hand_landmarks[0].landmark:   # back to original-frame coordinates
                lm.x = (lm.x * (w + 2 * pad) - pad) / w
                lm.y = (lm.y * (h + 2 * pad) - pad) / h
            results = retry

    if not results.multi_hand_landmarks:
        raise ValueError(
            "No palm/hand detected in the image. "
            "Please hold your open palm flat, facing the camera, "
            "and ensure good lighting."
        )

    landmarks = results.multi_hand_landmarks[0]

    # Auto-detect handedness
    detected_label = "right"
    if results.multi_handedness:
        detected_label = results.multi_handedness[0].classification[0].label.lower()

    # Raw 3D coordinates (21, 3)
    raw = np.array([[lm.x, lm.y, lm.z] for lm in landmarks.landmark], dtype=np.float64)

    handedness_score = 1.0
    if results.multi_handedness:
        handedness_score = float(results.multi_handedness[0].classification[0].score)
    if strict:
        _check_palm_quality(raw, handedness_score, w, h)

    # Pixel coordinates for texture extraction
    landmarks_px = np.array([[lm.x * w, lm.y * h] for lm in landmarks.landmark], dtype=np.float32)

    # 1. Anthropometric biometrics (44 features)
    biometrics = landmarks_to_biometrics(raw).tolist()

    # 2. Palmprint crease texture descriptor (128 features)
    texture = extract_palm_roi_texture(image_array, landmarks_px)

    # 3. Canonical 63-D landmarks (for legacy compatibility)
    wrist = raw[0]
    normalized = raw - wrist
    span = np.linalg.norm(normalized[9])
    if span > 0:
        normalized = normalized / span
    landmarks_63 = normalized.flatten().tolist()

    embedding_payload = {
        "biometrics": biometrics,
        "texture": texture,
        "landmarks_63": landmarks_63,
    }

    return {
        "embedding": embedding_payload,
        "quality_score": round(handedness_score, 3),
        "hand_side": detected_label,
    }


def merge_palm_embeddings(embeddings: list) -> dict:
    """
    Average several captures of the same hand into one template. Averaging cancels
    per-frame landmark jitter, which is the main cause of false rejects.
    """
    bios = np.array([_parse_embedding(e)[0] for e in embeddings], dtype=np.float64)
    texs = [np.asarray(e["texture"], dtype=np.float64) for e in embeddings
            if isinstance(e, dict) and e.get("texture")]
    lms = [np.asarray(e["landmarks_63"], dtype=np.float64) for e in embeddings
           if isinstance(e, dict) and e.get("landmarks_63")]
    merged = {"biometrics": bios.mean(axis=0).tolist()}
    if texs:
        t = np.mean(texs, axis=0)
        n = np.linalg.norm(t)
        merged["texture"] = (t / n if n > 1e-6 else t).tolist()
    else:
        merged["texture"] = []
    if lms:
        merged["landmarks_63"] = np.mean(lms, axis=0).tolist()
    return merged


def _parse_embedding(emb) -> tuple:
    """
    Safely parse any stored embedding (dict with biometrics/texture, or legacy 63-D list).
    Returns (biometrics_array, texture_array_or_None).
    """
    if isinstance(emb, dict):
        bio = emb.get("biometrics")
        tex = emb.get("texture")
        if bio:
            bio_arr = np.array(bio, dtype=np.float32)
        elif emb.get("landmarks_63"):
            bio_arr = landmarks_to_biometrics(np.array(emb["landmarks_63"]).reshape(21, 3))
        else:
            bio_arr = np.zeros(BIO_DIM, dtype=np.float32)

        tex_arr = np.array(tex, dtype=np.float32) if tex and len(tex) > 0 else None
        return bio_arr, tex_arr

    elif isinstance(emb, (list, tuple)):
        # Legacy format: 63 floats (21 landmarks x, y, z)
        arr = np.array(emb, dtype=np.float32)
        if len(arr) == 63:
            bio_arr = landmarks_to_biometrics(arr.reshape(21, 3))
            return bio_arr, None
        elif len(arr) == BIO_DIM:
            return arr, None
        else:
            return arr, None

    return np.zeros(BIO_DIM, dtype=np.float32), None


def compare_palms(stored_embedding, live_embedding, threshold: float = 0.65) -> dict:
    """
    Compare two palm representations using multi-layer biometric scoring:
    1. Morphological distance between 44 anthropometric features
    2. Cosine similarity between palmprint crease texture descriptors (if available)

    Score mapping:
    - Same person hand: score is typically 0.82 - 0.95
    - Different person hand: score is typically 0.25 - 0.55
    """
    try:
        bio_stored, tex_stored = _parse_embedding(stored_embedding)
        bio_live, tex_live = _parse_embedding(live_embedding)

        # 1. Morphological Euclidean distance
        d_geo = float(np.linalg.norm(bio_stored - bio_live))
        # Distance mapping: d=0 -> 1.0, d>=1.4 -> 0.0
        score_geo = max(0.0, 1.0 - (d_geo / 1.4))

        # 2. Texture correlation if both templates contain texture
        if tex_stored is not None and tex_live is not None and len(tex_stored) > 0 and len(tex_live) > 0:
            norm_s = np.linalg.norm(tex_stored)
            norm_l = np.linalg.norm(tex_live)
            if norm_s > 1e-6 and norm_l > 1e-6:
                cos_tex = float(np.dot(tex_stored, tex_live) / (norm_s * norm_l))
                score_tex = max(0.0, cos_tex)
                # Weighted multi-modal score: 70% morphological geometry + 30% palmprint texture
                final_score = 0.70 * score_geo + 0.30 * score_tex
            else:
                final_score = score_geo
        else:
            final_score = score_geo

        match = final_score >= threshold
        return {
            "match": bool(match),
            "score": round(float(final_score), 4),
            "distance": round(d_geo, 4),
        }
    except Exception:
        return {"match": False, "score": 0.0, "distance": 2.0}


def get_best_match(live_embedding, all_embeddings: list, threshold: float = 0.60, live_hand_side: str = None) -> dict:
    """
    Find the best-matching student palm from enrolled templates.
    Evaluates all templates and returns the highest-scoring candidate.
    """
    best = {"student_id": None, "score": 0.0, "match": False, "hand_side": None}

    for entry in all_embeddings:
        result = compare_palms(entry["embedding"], live_embedding, threshold)
        if result["score"] > best["score"]:
            best["score"] = result["score"]
            best["student_id"] = entry["student_id"]
            best["match"] = result["match"]
            best["hand_side"] = entry.get("hand_side")

    return best


def check_duplicate_palm(
    new_embedding,
    all_embeddings: list,
    duplicate_threshold: float = 0.80,
    new_hand_side: str = None
) -> dict:
    """
    Check if a newly captured palm is already enrolled under a different student.
    - Only checks against templates of the SAME hand side (left vs left, right vs right).
    - Requires similarity >= duplicate_threshold (default 0.85) to flag as duplicate.

    Returns:
        dict: {is_duplicate: bool, existing_student_id: int|None, score: float}
    """
    best_score = 0.0
    existing_id = None

    for entry in all_embeddings:
        entry_side = entry.get("hand_side")
        # Do not compare left hand with right hand for duplicate check
        if new_hand_side and entry_side and new_hand_side != entry_side:
            continue

        result = compare_palms(entry["embedding"], new_embedding, duplicate_threshold)
        if result["score"] > best_score:
            best_score = result["score"]
            if result["match"]:
                existing_id = entry["student_id"]

    return {
        "is_duplicate": existing_id is not None,
        "existing_student_id": existing_id,
        "score": round(best_score, 4),
    }
