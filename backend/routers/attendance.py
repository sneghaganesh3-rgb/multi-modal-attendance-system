import logging
import json
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from database.connection import get_db
from database.models import Student, FaceTemplate, PalmTemplate, FingerprintTemplate, Attendance, SystemSetting, AttendanceSession
from services.session_service import session_status, in_scope, late_cutoff
from services.face_service import (
    decode_image, encode_face, encode_face_image, embedding_similarity, face_index, MAX_FACE_TEMPLATES,
)
from services.palm_service import extract_palm_features, compare_palms, get_best_match as get_best_palm
from services.fusion_service import fuse_scores
from services.liveness_service import (
    new_challenge as new_liveness_challenge, check_liveness, LivenessError,
)
from services.webauthn_service import new_challenge, verify_assertion, parse_template, WebAuthnError
from routers.auth import get_current_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/attendance", tags=["attendance"], dependencies=[Depends(get_current_admin)])

IDENTITY_CONSISTENCY_MIN = 0.50   # same-person similarity between frames of one liveness burst
ADAPTIVE_MAX_REDUNDANCY = 0.93    # don't store a face nearly identical to one we already have


class ImagePayload(BaseModel):
    image_base64: str


class FingerprintAssertion(BaseModel):
    credential_id: str
    authenticator_data: str   # base64url
    client_data_json: str     # base64url
    signature: str            # base64url


class MultiModalPayload(BaseModel):
    face_frames: Optional[List[str]] = None     # liveness burst (data URLs), required for face
    liveness_token: Optional[str] = None        # from GET /attendance/liveness-challenge
    face_image: Optional[str] = None            # legacy single image: only if LIVENESS_REQUIRED = 0
    palm_image: Optional[str] = None
    fingerprint: Optional[FingerprintAssertion] = None
    session_id: Optional[int] = None            # mark attendance inside this session (see /sessions/open)


def get_settings(db: Session):
    settings = db.query(SystemSetting).all()
    return {s.key: float(s.value) if s.value.replace('.', '', 1).isdigit() else s.value for s in settings}


@router.get("/liveness-challenge")
def liveness_challenge():
    """One-time challenge (blink + head turn direction) for the face liveness check."""
    return new_liveness_challenge()


@router.post("/verify/face")
def verify_face(payload: ImagePayload, db: Session = Depends(get_db)):
    """Identify a face (no attendance is recorded, no liveness: use /verify/multimodal for that)."""
    settings = get_settings(db)
    threshold = settings.get('FACE_THRESHOLD', 0.5)

    try:
        live_result = encode_face(payload.image_base64.encode('utf-8'))
        scores = face_index.scores(db, live_result['embedding'])
        if scores:
            student_id, score = max(scores.items(), key=lambda kv: kv[1])
            if score >= threshold:
                student = db.query(Student).filter(Student.id == student_id).first()
                return {
                    "student_id": student.id,
                    "student_name": student.name,
                    "score": round(score, 4),
                    "match": True,
                    "message": "Face verified successfully"
                }
        return {"match": False, "message": "No match found"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/verify/palm")
def verify_palm(payload: ImagePayload, db: Session = Depends(get_db)):
    settings = get_settings(db)
    threshold = settings.get('PALM_THRESHOLD', 0.7)

    try:
        live_result = extract_palm_features(payload.image_base64.encode('utf-8'))
        all_templates = (
            db.query(PalmTemplate).join(Student, Student.id == PalmTemplate.student_id)
            .filter(Student.is_active == True).all()
        )
        template_list = [
            {"student_id": t.student_id, "embedding": json.loads(t.embedding), "hand_side": t.hand_side}
            for t in all_templates
        ]

        match = get_best_palm(
            live_result['embedding'],
            template_list,
            threshold,
            live_hand_side=live_result.get('hand_side')
        )

        if match['match']:
            student = db.query(Student).filter(Student.id == match['student_id']).first()
            return {
                "student_id": student.id,
                "student_name": student.name,
                "score": match['score'],
                "match": True,
                "message": "Palm verified successfully"
            }
        return {"match": False, "message": "No match found"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/fingerprint-challenge")
def fingerprint_challenge(db: Session = Depends(get_db)):
    """
    Challenge + the credential ids of enrolled students, so the browser asks the
    device sensor to sign with one of them. enrolled=False means nobody has
    enrolled a fingerprint yet.
    """
    creds = []
    rows = (
        db.query(FingerprintTemplate)
        .join(Student, Student.id == FingerprintTemplate.student_id)
        .filter(Student.is_active == True)
        .all()
    )
    for row in rows:
        t = parse_template(row.template)
        if t:
            creds.append(t["credential_id"])
    return {"challenge": new_challenge(), "allow_credentials": creds, "enrolled": bool(creds)}


def _extract_live_face(payload: MultiModalPayload, settings: dict, warnings: list):
    """
    Returns (embedding | None, liveness_summary | None, rejection_dict | None).
    A failed liveness check is a hard rejection, not a silent fallback to other modalities.
    """
    liveness_required = settings.get("LIVENESS_REQUIRED", 1.0) >= 1

    if payload.face_frames:
        try:
            live = check_liveness(payload.face_frames, payload.liveness_token)
        except LivenessError as e:
            return None, None, {"match": False, "spoof_suspected": False, "message": str(e)}
        summary = {k: live[k] for k in ("live", "score", "reason", "checks", "direction") if k in live}
        if not live["live"]:
            logger.warning("Liveness check failed: %s | %s", live["reason"], live["checks"])
            return None, summary, {
                "match": False, "spoof_suspected": True, "liveness": summary,
                "message": f"Liveness check failed: {live['reason']}",
            }

        # Identity must stay the same through the whole burst (blocks face swaps mid-clip)
        embeddings = []
        errors = []
        n = len(payload.face_frames)
        # Preferred frames first; if none gives a usable face, fall back to the rest of the burst
        fallback = [i for i in range(0, n, max(1, n // 8)) if i not in live["sample_indices"]]
        for i in list(live["sample_indices"]) + fallback:
            if embeddings and i not in live["sample_indices"]:
                break
            try:
                emb = encode_face_image(decode_image(payload.face_frames[i]))["embedding"]
            except ValueError as e:
                errors.append(str(e))
                continue
            embeddings.append((i, emb))
        if not embeddings:
            warnings.append(f"Face: {errors[-1] if errors else 'no usable frame'}")
            return None, summary, None
        for a in range(len(embeddings)):
            for b in range(a + 1, len(embeddings)):
                if embedding_similarity(embeddings[a][1], embeddings[b][1]) < IDENTITY_CONSISTENCY_MIN:
                    logger.warning("Face identity changed during liveness burst")
                    return None, summary, {
                        "match": False, "spoof_suspected": True, "liveness": summary,
                        "message": "The face changed during the liveness check. Please try again.",
                    }
        best = next((e for i, e in embeddings if i == live["best_index"]), embeddings[0][1])
        return best, summary, None

    if payload.face_image:
        if liveness_required:
            warnings.append("Face: a liveness check is required (record the face with the live camera).")
            return None, None, None
        try:
            return encode_face(payload.face_image.encode('utf-8'))["embedding"], None, None
        except Exception as e:
            warnings.append(f"Face: {str(e)}")
    return None, None, None


def _maybe_add_adaptive_template(db: Session, student_id: int, embedding: list, face_score: float, settings: dict) -> bool:
    """
    Learn the student's current look (hair, glasses, aging) from a verified attempt.
    Only when identity was confirmed by a second modality, so a look-alike or a
    spoof can never teach the system a wrong face.
    """
    if settings.get("ADAPTIVE_ENROLL", 1.0) < 1 or face_score < settings.get("ADAPTIVE_MIN_FACE", 0.75):
        return False

    templates = db.query(FaceTemplate).filter(FaceTemplate.student_id == student_id).all()
    recent = datetime.utcnow() - timedelta(hours=24)
    for t in templates:
        created = t.created_at.replace(tzinfo=None) if t.created_at else None
        if t.source == "adaptive" and created and created >= recent:
            return False      # at most one adaptive update per day
    for t in templates:
        if embedding_similarity(json.loads(t.embedding), embedding) > ADAPTIVE_MAX_REDUNDANCY:
            return False      # nothing new to learn

    if len(templates) >= MAX_FACE_TEMPLATES:
        adaptive = sorted((t for t in templates if t.source == "adaptive"), key=lambda t: t.id)
        if not adaptive:
            return False
        db.delete(adaptive[0])  # replace the oldest adaptive sample; enrolled ones are kept

    db.add(FaceTemplate(student_id=student_id, embedding=json.dumps(embedding),
                        quality_score=face_score, source="adaptive"))
    db.commit()
    return True


@router.post("/verify/multimodal")
def verify_multimodal(payload: MultiModalPayload, db: Session = Depends(get_db)):
    settings = get_settings(db)

    # 0. Session window: attendance can only be marked while the session is open
    session = None
    if payload.session_id is not None:
        session = db.query(AttendanceSession).filter(AttendanceSession.id == payload.session_id).first()
        if session is None:
            return {"match": False, "message": "That attendance session does not exist."}
        state = session_status(session)
        if state != "open":
            return {"match": False, "session_state": state,
                    "message": f"Session '{session.title}' is {state}. Attendance can only be marked while it is open."}
    elif settings.get("SESSION_REQUIRED", 0.0) >= 1:
        return {"match": False, "message": "Select an open attendance session first. No session is selected."}

    live_palm_emb = None
    fp_student_id = None   # student whose fingerprint was cryptographically verified
    warnings = []

    # 1. Face: server-side liveness + identity from the same capture
    live_face_emb, liveness, rejection = _extract_live_face(payload, settings, warnings)
    if rejection:
        return rejection

    # 2. Extract Palm features if image provided
    if payload.palm_image:
        try:
            palm_res = extract_palm_features(payload.palm_image.encode('utf-8'))
            live_palm_emb = palm_res.get('embedding')
        except Exception as e:
            logger.warning("Palm extraction failed: %s", e)
            warnings.append(f"Palm: {str(e)}")

    # 3. Verify fingerprint assertion (device sensor, WebAuthn)
    if payload.fingerprint:
        fp = payload.fingerprint
        try:
            for row in db.query(FingerprintTemplate).all():
                t = parse_template(row.template)
                if t and t["credential_id"] == fp.credential_id:
                    new_count = verify_assertion(t, fp.authenticator_data, fp.client_data_json, fp.signature)
                    t["sign_count"] = new_count
                    row.template = json.dumps(t)
                    db.commit()
                    fp_student_id = row.student_id
                    break
            else:
                raise WebAuthnError("This fingerprint is not enrolled")
        except WebAuthnError as e:
            warnings.append(f"Fingerprint: {str(e)}")

    if live_face_emb is None and live_palm_emb is None and fp_student_id is None:
        err_msg = "No valid biometrics detected in the submitted input."
        if warnings:
            err_msg += " " + " | ".join(warnings)
        raise HTTPException(status_code=400, detail=err_msg)

    active_students = db.query(Student).filter(Student.is_active == True).all()
    if not active_students:
        return {"match": False, "message": "No active students enrolled in system", "warnings": warnings or None}

    weights = {
        'FACE': settings.get('FACE_WEIGHT', 0.45),
        'FINGERPRINT': settings.get('FINGERPRINT_WEIGHT', 0.35),
        'PALM': settings.get('PALM_WEIGHT', 0.20)
    }
    thresholds = {
        'FUSION_THRESHOLD': settings.get('FUSION_THRESHOLD', 0.60),
        'FACE_THRESHOLD': settings.get('FACE_THRESHOLD', 0.50),
        'PALM_THRESHOLD': settings.get('PALM_THRESHOLD', 0.60),
        'FINGERPRINT_THRESHOLD': settings.get('FINGERPRINT_THRESHOLD', 0.75),
        'SINGLE_MODALITY_MARGIN': settings.get('SINGLE_MODALITY_MARGIN', 0.10),
    }

    # Vectorized 1:N face search (best template per student)
    face_scores = face_index.scores(db, live_face_emb) if live_face_emb is not None else {}

    all_palm_templates = {}
    if live_palm_emb is not None:
        for pt in db.query(PalmTemplate).all():
            all_palm_templates.setdefault(pt.student_id, []).append(json.loads(pt.embedding))

    candidates = []
    for s in active_students:
        s_face_score = face_scores.get(s.id)
        s_palm_score = None
        s_fp_score = None

        if live_palm_emb is not None and s.id in all_palm_templates:
            s_palm_score = max(
                compare_palms(p_emb, live_palm_emb, threshold=0.0)['score']
                for p_emb in all_palm_templates[s.id]
            )

        if fp_student_id is not None:
            s_fp_score = 1.0 if s.id == fp_student_id else 0.0

        fusion = fuse_scores(s_face_score, s_fp_score, s_palm_score, weights, thresholds)
        if not fusion['modalities_used']:
            continue
        candidates.append((s, fusion, {'face': s_face_score, 'palm': s_palm_score, 'fingerprint': s_fp_score}))

    if not candidates:
        return {"match": False, "message": "No match found across student records", "warnings": warnings or None}

    # Verified candidates first, then the strongest fusion score
    candidates.sort(key=lambda c: (c[1]['decision'] == 'verified', c[1]['fusion_score'], c[1]['confidence']), reverse=True)
    best_student, best_fusion_result, best_individual_scores = candidates[0]
    is_verified = best_fusion_result['decision'] == 'verified'

    # Ambiguity guard: two different people both plausibly match -> don't guess
    ambiguous = False
    if is_verified and len(candidates) > 1:
        runner_up = candidates[1]
        margin = settings.get('AMBIGUITY_MARGIN', 0.05)
        if runner_up[1]['decision'] == 'verified' and \
                best_fusion_result['fusion_score'] - runner_up[1]['fusion_score'] < margin:
            ambiguous = True
            is_verified = False
            best_fusion_result = {**best_fusion_result, "decision": "rejected",
                                  "message": "Ambiguous match: more than one person matches closely. "
                                             "Add palm or fingerprint and try again."}

    # Tell the user why a captured modality contributed nothing (e.g. not enrolled for this person)
    if live_face_emb is not None and best_individual_scores.get('face') is None:
        warnings.append(f"Face: no face template enrolled for {best_student.name}")
    if live_palm_emb is not None and best_individual_scores.get('palm') is None:
        warnings.append(f"Palm: no palm enrolled for {best_student.name}")

    # The person must belong to the class group of the session
    if is_verified and session is not None and not in_scope(session, best_student):
        is_verified = False
        best_fusion_result = {**best_fusion_result, "decision": "rejected",
                              "message": f"{best_student.name} is not part of session '{session.title}'."}

    already_marked = False
    adaptive_added = False
    marked_status = None
    if is_verified:
        dup = db.query(Attendance).filter(
            Attendance.student_id == best_student.id,
            Attendance.date == datetime.now().date(),
        )
        if session is not None:
            dup = dup.filter(Attendance.session_id == session.id)
        already_marked = dup.first() is not None

        if not already_marked:
            now = datetime.now()
            marked_status = "late" if (session is not None and now > late_cutoff(session)) else "present"
            db.add(Attendance(
                student_id=best_student.id,
                session_id=session.id if session is not None else None,
                date=now.date(),
                time_in=now.time(),
                face_score=best_individual_scores.get('face'),
                palm_score=best_individual_scores.get('palm'),
                fingerprint_score=best_individual_scores.get('fingerprint'),
                fusion_score=best_fusion_result['fusion_score'],
                verification_method="multimodal",
                status=marked_status
            ))
            db.commit()

        # Adaptive learning needs a live, verified face confirmed by another modality
        others_confirmed = (best_individual_scores.get('palm') is not None and
                            best_individual_scores['palm'] >= thresholds['PALM_THRESHOLD']) or \
                           best_individual_scores.get('fingerprint') == 1.0
        if liveness and liveness.get("live") and live_face_emb is not None and others_confirmed \
                and best_individual_scores.get('face') is not None:
            adaptive_added = _maybe_add_adaptive_template(
                db, best_student.id, live_face_emb, best_individual_scores['face'], settings)

    return {
        "student_id": best_student.id,
        "student_name": best_student.name,
        "fusion_result": best_fusion_result,
        "match": is_verified,
        "ambiguous": ambiguous,
        "already_marked_today": already_marked,
        "attendance_status": marked_status,
        "session": {"id": session.id, "title": session.title} if session is not None else None,
        "liveness": liveness,
        "adaptive_template_added": adaptive_added,
        "warnings": warnings if warnings else None
    }


@router.get("/")
def get_attendance(
    date_from:  Optional[date] = None,
    date_to:    Optional[date] = None,
    student_id: Optional[int]  = None,
    status:     Optional[str]  = None,
    department: Optional[str]  = None,
    db:         Session        = Depends(get_db),
    _:          None           = Depends(get_current_admin),
):
    query = db.query(Attendance).join(Student)
    if date_from:   query = query.filter(Attendance.date >= date_from)
    if date_to:     query = query.filter(Attendance.date <= date_to)
    if student_id:  query = query.filter(Attendance.student_id == student_id)
    if status:      query = query.filter(Attendance.status == status)
    if department:  query = query.filter(Student.department == department)

    records = query.order_by(Attendance.date.desc(), Attendance.time_in.desc()).all()
    return [
        {
            "id":                  r.id,
            "date":                r.date.isoformat()    if r.date    else None,
            "time_in":             str(r.time_in)        if r.time_in else None,
            "face_score":          r.face_score,
            "palm_score":          r.palm_score,
            "fingerprint_score":   r.fingerprint_score,
            "fusion_score":        r.fusion_score,
            "verification_method": r.verification_method,
            "status":              r.status,
            "student": {
                "name":       r.student.name,
                "student_id": r.student.student_id,
                "department": r.student.department,
            },
        }
        for r in records
    ]


@router.get("/today")
def get_today_attendance(
    db: Session = Depends(get_db),
    _:  None    = Depends(get_current_admin),
):
    today = datetime.now().date()
    records = db.query(Attendance).filter(Attendance.date == today).all()
    return [
        {
            "id":      r.id,
            "time_in": str(r.time_in) if r.time_in else None,
            "status":  r.status,
            "student": {
                "name":       r.student.name,
                "student_id": r.student.student_id,
            },
        }
        for r in records
    ]


@router.get("/stats")
def get_attendance_stats(
    db: Session = Depends(get_db),
    _:  None    = Depends(get_current_admin),
):
    today          = datetime.now().date()
    total_students = db.query(Student).filter(Student.is_active == True).count()
    present_today  = db.query(Attendance).filter(Attendance.date == today, Attendance.status == "present").count()
    late_today     = db.query(Attendance).filter(Attendance.date == today, Attendance.status == "late").count()
    absent_today   = max(0, total_students - (present_today + late_today))

    return {
        "total_students": total_students,
        "present_today":  present_today,
        "late_today":     late_today,
        "absent_today":   absent_today,
        "last_7_days":    [],   # placeholder — populated by reports endpoint
    }

