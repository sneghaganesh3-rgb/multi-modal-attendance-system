from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from database.models import AttendanceSession, Attendance, SystemSetting
from routers.auth import get_current_admin
from services.session_service import session_to_dict, session_status, absentees
from services.notify_service import notify_absentees_background

router = APIRouter(prefix="/sessions", tags=["sessions"], dependencies=[Depends(get_current_admin)])


class SessionCreate(BaseModel):
    title: str
    department: Optional[str] = None
    year: Optional[int] = None
    section: Optional[str] = None
    start_time: Optional[datetime] = None     # default: now (local time)
    duration_minutes: int = 60
    grace_minutes: int = 10


def _get(db: Session, session_id: int) -> AttendanceSession:
    s = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return s


@router.post("/")
def create_session(body: SessionCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    if not (1 <= body.duration_minutes <= 24 * 60):
        raise HTTPException(status_code=400, detail="Duration must be between 1 minute and 24 hours")
    if body.grace_minutes < 0:
        raise HTTPException(status_code=400, detail="Grace minutes cannot be negative")
    start = (body.start_time or datetime.now()).replace(tzinfo=None, microsecond=0)
    s = AttendanceSession(
        title=body.title.strip(),
        department=(body.department or "").strip() or None,
        year=body.year,
        section=(body.section or "").strip() or None,
        start_time=start,
        end_time=start + timedelta(minutes=body.duration_minutes),
        grace_minutes=body.grace_minutes,
        created_by=admin.username,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return session_to_dict(db, s)


@router.get("/")
def list_sessions(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.query(AttendanceSession).order_by(AttendanceSession.start_time.desc()).limit(limit).all()
    return [session_to_dict(db, s) for s in rows]


@router.get("/open")
def open_sessions(db: Session = Depends(get_db)):
    """Sessions that accept attendance right now (used by Mark Attendance and Kiosk)."""
    rows = db.query(AttendanceSession).filter(AttendanceSession.closed_at.is_(None)).all()
    return [session_to_dict(db, s) for s in rows if session_status(s) == "open"]


@router.get("/{session_id}")
def session_detail(session_id: int, db: Session = Depends(get_db)):
    s = _get(db, session_id)
    marked = db.query(Attendance).filter(Attendance.session_id == s.id).order_by(Attendance.time_in).all()
    return {
        **session_to_dict(db, s),
        "attendance": [{
            "student_id": a.student.student_id, "name": a.student.name,
            "time_in": str(a.time_in), "status": a.status, "fusion_score": a.fusion_score,
        } for a in marked],
        "absent": [{"student_id": st.student_id, "name": st.name} for st in absentees(db, s)],
    }


@router.post("/{session_id}/close")
def close_session(session_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    s = _get(db, session_id)
    if s.closed_at is None:
        s.closed_at = datetime.now()
        db.commit()
    flag = db.query(SystemSetting).filter(SystemSetting.key == "NOTIFY_ON_SESSION_CLOSE").first()
    notify = bool(flag and flag.value.strip() in ("1", "1.0"))
    if notify:
        background.add_task(notify_absentees_background, s.id)
    return {**session_to_dict(db, s), "absence_alerts_queued": notify}


@router.delete("/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    s = _get(db, session_id)
    if db.query(Attendance).filter(Attendance.session_id == s.id).first():
        raise HTTPException(status_code=400, detail="This session has attendance records. Close it instead of deleting.")
    db.delete(s)
    db.commit()
    return {"message": "Session deleted"}
