"""
Multi-modal score fusion.

Per-student decision from up to three modality scores (face / fingerprint / palm).

Compared with a plain weighted average this adds:
  * Calibration  - each raw score is mapped to a 0-1 confidence around its own
                   threshold (score == threshold -> 0.5), so modalities with
                   different score scales become comparable. Reported as
                   `calibrated` / `confidence`.
  * Veto         - a modality that WAS captured but scores far below its
                   threshold (clearly a different person / wrong finger) rejects
                   the attempt even if the other modalities push the average up.
  * Single-modality margin - with only one modality there is nothing to
                   cross-check, so it must clear its threshold by an extra
                   margin (SINGLE_MODALITY_MARGIN, default 0.10).
  * Weights are renormalised over the modalities that are present.
"""

import math

CALIBRATION_TAU = 0.08      # steepness of the score -> confidence curve
VETO_FACTOR = 0.60          # veto when score < VETO_FACTOR * modality threshold
DEFAULT_SINGLE_MARGIN = 0.10


def _calibrate(score: float, threshold: float) -> float:
    z = (score - threshold) / CALIBRATION_TAU
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def _modality_thresholds(thresholds: dict) -> dict:
    return {
        "face": thresholds.get("FACE_THRESHOLD", 0.50),
        "palm": thresholds.get("PALM_THRESHOLD", 0.55),
        "fingerprint": thresholds.get("FINGERPRINT_THRESHOLD", 0.75),
    }


def check_fallback_rules(face_score, fingerprint_score, palm_score, thresholds: dict) -> dict:
    """
    Accept when two or more modalities each clear their own threshold, even if the
    weighted average is slightly below the fusion threshold.
    Returns {verified: bool, reason: str}
    """
    t = _modality_thresholds(thresholds)
    passed = [
        name for name, sc in (("face", face_score), ("fingerprint", fingerprint_score), ("palm", palm_score))
        if sc is not None and sc >= t[name]
    ]
    present = sum(1 for sc in (face_score, fingerprint_score, palm_score) if sc is not None)
    if present >= 2 and len(passed) == present:
        return {"verified": True, "reason": " + ".join(n.capitalize() for n in passed) + " matched"}
    return {"verified": False, "reason": "Biometric match below minimum threshold"}


def fuse_scores(face_score, fingerprint_score, palm_score, weights: dict, thresholds: dict) -> dict:
    """Multi-modal score fusion combining Face, Palm, and Fingerprint."""
    raw = {}
    if face_score is not None:
        raw["face"] = float(face_score)
    if fingerprint_score is not None:
        raw["fingerprint"] = float(fingerprint_score)
    if palm_score is not None:
        raw["palm"] = float(palm_score)

    fusion_threshold = thresholds.get("FUSION_THRESHOLD", 0.55)

    if not raw:
        return {
            "fusion_score": 0.0, "confidence": 0.0, "decision": "rejected",
            "modalities_used": [], "individual_scores": {}, "calibrated": {},
            "threshold": fusion_threshold, "message": "No biometrics provided",
        }

    mod_thr = _modality_thresholds(thresholds)
    base_w = {
        "face": weights.get("FACE", 0.45),
        "fingerprint": weights.get("FINGERPRINT", 0.35),
        "palm": weights.get("PALM", 0.20),
    }
    total_w = sum(base_w[m] for m in raw)
    norm_w = {m: (base_w[m] / total_w if total_w > 0 else 1.0 / len(raw)) for m in raw}

    fusion_score = round(sum(raw[m] * norm_w[m] for m in raw), 4)
    calibrated = {m: round(_calibrate(raw[m], mod_thr[m]), 4) for m in raw}
    confidence = round(sum(calibrated[m] * norm_w[m] for m in raw), 4)
    scores = {m: round(v, 4) for m, v in raw.items()}

    result = {
        "fusion_score": fusion_score,
        "confidence": confidence,
        "modalities_used": list(raw.keys()),
        "individual_scores": scores,
        "calibrated": calibrated,
        "threshold": fusion_threshold,
    }

    # 1. Veto: a captured modality that clearly contradicts the identity
    for m, v in raw.items():
        if v < VETO_FACTOR * mod_thr[m]:
            return {**result, "decision": "rejected",
                    "message": f"{m.capitalize()} does not match this person ({v * 100:.1f}%)"}

    # 2. Single modality needs an extra margin
    if len(raw) == 1:
        (m, v), = raw.items()
        margin = thresholds.get("SINGLE_MODALITY_MARGIN", DEFAULT_SINGLE_MARGIN)
        needed = max(fusion_threshold, mod_thr[m] + margin)
        if v >= needed:
            return {**result, "decision": "verified",
                    "message": f"Identity verified by {m} alone ({v * 100:.1f}% >= {needed * 100:.1f}%)"}
        return {**result, "decision": "rejected",
                "message": f"{m.capitalize()} alone ({v * 100:.1f}%) is below the {needed * 100:.1f}% needed "
                           f"without a second modality. Add palm or fingerprint."}

    # 3. Weighted fusion, with the two-modality fallback
    if fusion_score >= fusion_threshold:
        return {**result, "decision": "verified",
                "message": f"Identity verified successfully (Score: {fusion_score * 100:.1f}% >= "
                           f"Threshold: {fusion_threshold * 100:.1f}%)"}

    fallback = check_fallback_rules(face_score, fingerprint_score, palm_score, thresholds)
    if fallback["verified"]:
        return {**result, "decision": "verified", "message": f"Verified: {fallback['reason']}"}
    return {**result, "decision": "rejected",
            "message": f"Fusion score ({fusion_score * 100:.1f}%) is below the required threshold "
                       f"({fusion_threshold * 100:.1f}%)"}
