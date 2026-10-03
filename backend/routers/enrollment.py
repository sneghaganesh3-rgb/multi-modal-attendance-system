from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import json

from database.connection import get_db
from database.models import Student, FaceTemplate, PalmTemplate, FingerprintTemplate
from services.face_service import encode_face, embedding_similarity, face_index, MAX_FACE_TEMPLATES
from services.palm_service import extract_palm_features, check_duplicate_palm, compare_palms, merge_palm_embeddings
from services.webauthn_service import new_challenge, verify_registration, parse_template, WebAuthnError
from routers.auth import get_current_admin

router = APIRouter(prefix="/enrollment", tags=["enrollment"], dependencies=[Depends(get_current_admin)])

MAX_PHOTOS_PER_REQUEST = 8
BATCH_CONSISTENCY_MIN_FACE = 0.50   # photos in one request must be the same person
BATCH_CONSISTENCY_MIN_PALM = 0.60   # ... and the same hand
FACE_DUPLICATE_THRESHOLD = 0.85


class ImagePayload(BaseModel):
    image_base64: Optional[str] = None        # single photo
    images: Optional[List[str]] = None        # several photos (recommended: front + slight left/right)
    hand_side: Optional[str] = None           # "left" or "right" — optional hint, auto-detected
    append: bool = False                      # face only: add to existing templates instead of replacing


class FingerprintPayload(BaseModel):
    credential_id: str        # base64url
    public_key: str           # base64url SPKI (from AuthenticatorAttestationResponse.getPublicKey())
    client_data_json: str     # base64url


def _photos(payload: ImagePayload) -> List[str]:
    photos = payload.images or ([payload.image_base64] if payload.image_base64 else [])
    photos = [p for p in photos if p]
    if not photos:
        raise HTTPException(status_code=400, detail="No image provided.")
    if len(photos) > MAX_PHOTOS_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"At most {MAX_PHOTOS_PER_REQUEST} photos per request.")
    return photos


def _label(i: int, total: int) -> str:
    return f"Photo {i + 1}: " if total > 1 else ""


# ─── Face (several templates per student) ───────────────────────────────────

@router.post("/face/{student_id}")
def enroll_face(student_id: int, payload: ImagePayload, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    photos = _photos(payload)
    try:
        # 1. Encode every photo with enrollment-grade quality checks
        results = []
        for i, img in enumerate(photos):
            try:
                results.append(encode_face(img.encode("utf-8"), enforce_quality=True))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"{_label(i, len(photos))}{e}")

        # 2. All photos must show the same person
        for a in range(len(results)):
            for b in range(a + 1, len(results)):
                if embedding_similarity(results[a]["embedding"], results[b]["embedding"]) < BATCH_CONSISTENCY_MIN_FACE:
                    raise HTTPException(status_code=400,
                                        detail="The photos do not look like the same person. Retake them one person at a time.")

        # 3. Duplicate detection against every template of every OTHER student
        for r in results:
            others = face_index.scores(db, r["embedding"], exclude_student=student_id)
            if others:
                other_id, score = max(others.items(), key=lambda kv: kv[1])
                if score >= FACE_DUPLICATE_THRESHOLD:
                    other = db.query(Student).filter(Student.id == other_id).first()
                    name = other.name if other else f"ID {other_id}"
                    raise HTTPException(
                        status_code=409,
                        detail=f"This face is already registered to '{name}' "
                               f"(similarity {score * 100:.1f}%). Duplicate biometrics are not allowed."
                    )

        # 4. Replace or append
        if not payload.append:
            db.query(FaceTemplate).filter(FaceTemplate.student_id == student_id).delete()
        existing = db.query(FaceTemplate).filter(FaceTemplate.student_id == student_id).order_by(FaceTemplate.id).all()
        overflow = len(existing) + len(results) - MAX_FACE_TEMPLATES
        if overflow > 0:
            adaptive = [t for t in existing if t.source == "adaptive"]
            if len(adaptive) < overflow:
                raise HTTPException(status_code=400,
                                    detail=f"A student can have at most {MAX_FACE_TEMPLATES} face templates. "
                                           f"Re-enroll without 'append' to replace them.")
            for t in adaptive[:overflow]:
                db.delete(t)

        for r in results:
            db.add(FaceTemplate(
                student_id=student_id,
                embedding=json.dumps(r["embedding"]),
                quality_score=r["quality_score"],
                source="enroll",
            ))
        db.commit()
        total = db.query(FaceTemplate).filter(FaceTemplate.student_id == student_id).count()
        return {
            "message": "Face enrolled successfully",
            "quality_score": round(sum(r["quality_score"] for r in results) / len(results), 4),
            "photos_used": len(results),
            "templates": total,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Palm (auto-detects Left / Right; several shots are averaged) ───────────

@router.post("/palm/{student_id}")
def enroll_palm(student_id: int, payload: ImagePayload, db: Session = Depends(get_db)):
    """
    Enroll a palm print.  The backend auto-detects which hand is shown.
    Several shots of the same hand are averaged into one template, which cancels
    per-frame landmark noise. The optional `hand_side` hint is used only if
    MediaPipe cannot determine handedness.
    """
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    photos = _photos(payload)
    try:
        shots = []
        for i, img in enumerate(photos):
            try:
                shots.append(extract_palm_features(img.encode("utf-8"), strict=True))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"{_label(i, len(photos))}{e}")

        sides = {s.get("hand_side") for s in shots if s.get("hand_side")}
        if len(sides) > 1:
            raise HTTPException(status_code=400, detail="The photos show different hands. Use the same hand for every shot.")
        hand_side = (sides.pop() if sides else None) or payload.hand_side or "right"

        for s in shots[1:]:
            if compare_palms(shots[0]["embedding"], s["embedding"], 0.0)["score"] < BATCH_CONSISTENCY_MIN_PALM:
                raise HTTPException(status_code=400,
                                    detail="The palm shots are inconsistent. Hold the hand steady and flat for every shot.")

        embedding = shots[0]["embedding"] if len(shots) == 1 else merge_palm_embeddings([s["embedding"] for s in shots])
        quality = round(sum(s["quality_score"] for s in shots) / len(shots), 3)

        # ── Duplicate detection (same hand side, other students) ─────────
        existing_templates = (
            db.query(PalmTemplate)
            .filter(PalmTemplate.student_id != student_id)
            .all()
        )
        if existing_templates:
            template_list = [
                {
                    "student_id": t.student_id,
                    "embedding": json.loads(t.embedding),
                    "hand_side": t.hand_side
                }
                for t in existing_templates
            ]
            dup = check_duplicate_palm(embedding, template_list, duplicate_threshold=0.80, new_hand_side=hand_side)
            if dup["is_duplicate"]:
                existing_student = db.query(Student).filter(Student.id == dup["existing_student_id"]).first()
                name = existing_student.name if existing_student else f"ID {dup['existing_student_id']}"
                raise HTTPException(
                    status_code=409,
                    detail=f"This palm is already registered to '{name}' "
                           f"(similarity {dup['score']*100:.1f}%). "
                           f"Duplicate biometrics are not allowed."
                )

        # ── Overwrite template for this hand side only ───────────────────
        db.query(PalmTemplate).filter(
            PalmTemplate.student_id == student_id,
            PalmTemplate.hand_side == hand_side,
        ).delete()
        db.add(PalmTemplate(
            student_id=student_id,
            hand_side=hand_side,
            embedding=json.dumps(embedding),
            quality_score=quality,
        ))
        db.commit()
        return {
            "message": f"{hand_side.capitalize()} palm enrolled successfully",
            "hand_side": hand_side,
            "quality_score": quality,
            "photos_used": len(shots),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Fingerprint (device sensor via WebAuthn) ──────────────────────────────

@router.get("/fingerprint-challenge")
def fingerprint_challenge():
    """One-time challenge the browser signs when creating the fingerprint credential."""
    return {"challenge": new_challenge()}


@router.post("/fingerprint/{student_id}")
def enroll_fingerprint(
    student_id: int,
    payload: FingerprintPayload,
    db: Session = Depends(get_db),
):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    try:
        verify_registration(payload.client_data_json, payload.public_key)
    except WebAuthnError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # One physical credential must not belong to two students
    for t in db.query(FingerprintTemplate).filter(FingerprintTemplate.student_id != student_id).all():
        parsed = parse_template(t.template)
        if parsed and parsed["credential_id"] == payload.credential_id:
            raise HTTPException(status_code=409, detail="This fingerprint credential is already registered to another student.")

    db.query(FingerprintTemplate).filter(
        FingerprintTemplate.student_id == student_id
    ).delete()
    db.add(FingerprintTemplate(
        student_id=student_id,
        template=json.dumps({
            "credential_id": payload.credential_id,
            "public_key": payload.public_key,
            "sign_count": 0,
        }),
        quality_score=1.0,
    ))
    db.commit()
    return {"message": "Fingerprint enrolled successfully"}


# ─── Delete endpoints ───────────────────────────────────────────────────────

@router.delete("/face/{student_id}")
def delete_face(student_id: int, db: Session = Depends(get_db)):
    db.query(FaceTemplate).filter(FaceTemplate.student_id == student_id).delete()
    db.commit()
    return {"message": "Face template removed"}


@router.delete("/palm/{student_id}")
def delete_palm(
    student_id: int,
    hand_side: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(PalmTemplate).filter(PalmTemplate.student_id == student_id)
    if hand_side:
        q = q.filter(PalmTemplate.hand_side == hand_side)
    q.delete()
    db.commit()
    return {"message": "Palm template(s) removed"}


@router.delete("/fingerprint/{student_id}")
def delete_fingerprint(student_id: int, db: Session = Depends(get_db)):
    db.query(FingerprintTemplate).filter(
        FingerprintTemplate.student_id == student_id
    ).delete()
    db.commit()
    return {"message": "Fingerprint template removed"}
