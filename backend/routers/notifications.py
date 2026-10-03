from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db, SessionLocal
from database.models import Student, Notification, SystemSetting, Attendance
from routers.auth import get_current_admin
from services.attendance_stats import student_summary
from services.notify_service import (
    notify_student, absence_message, low_attendance_message,
)

router = APIRouter(prefix="/notifications", tags=["notifications"], dependencies=[Depends(get_current_admin)])


class LowAttendanceBody(BaseModel):
    threshold: Optional[float] = None      # default: LOW_ATTENDANCE_THRESHOLD setting
    dry_run: bool = False                  # only list who would be alerted


class AbsenceBody(BaseModel):
    target_date: Optional[date] = None     # default: today
    dry_run: bool = False


class CustomBody(BaseModel):
    student_id: int
    subject: str
    message: str


def _setting(db: Session, key: str, default: float) -> float:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    try:
        return float(row.value) if row else default
    except ValueError:
        return default


def _send_many(items):
    """items: list of (student_id, kind, subject, body). Own DB session: runs after the response."""
    db = SessionLocal()
    try:
        for sid, kind, subject, body in items:
            st = db.query(Student).filter(Student.id == sid).first()
            if st:
                notify_student(db, st, kind, subject, body)
    finally:
        db.close()


def _channels(st: Student) -> list:
    return [c for c, v in (("email", st.email), ("sms", st.phone)) if v]


@router.get("/")
def notification_log(limit: int = 100, status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Notification)
    if status:
        q = q.filter(Notification.status == status)
    rows = q.order_by(Notification.id.desc()).limit(min(limit, 500)).all()
    names = {s.id: s.name for s in db.query(Student).filter(Student.id.in_({r.student_id for r in rows if r.student_id})).all()}
    return [{
        "id": r.id, "student": names.get(r.student_id), "channel": r.channel, "kind": r.kind,
        "recipient": r.recipient, "subject": r.subject, "status": r.status, "error": r.error,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


@router.get("/config")
def notification_config():
    import os
    return {
        "email_configured": bool(os.getenv("SMTP_HOST")),
        "sms_configured": all(os.getenv(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM")),
    }


@router.post("/low-attendance")
def alert_low_attendance(body: LowAttendanceBody, background: BackgroundTasks, db: Session = Depends(get_db)):
    threshold = body.threshold if body.threshold is not None else _setting(db, "LOW_ATTENDANCE_THRESHOLD", 75.0)
    if not (0 < threshold <= 100):
        raise HTTPException(status_code=400, detail="Threshold must be between 0 and 100")
    targets, items = [], []
    for st in db.query(Student).filter(Student.is_active == True).all():
        summary = student_summary(db, st)
        pct = summary["percentage"]
        if pct is None or pct >= threshold:
            continue
        targets.append({"student_id": st.student_id, "name": st.name, "percentage": pct, "channels": _channels(st)})
        subject, text = low_attendance_message(st, pct, threshold)
        items.append((st.id, "low_attendance", subject, text))
    if not body.dry_run and items:
        background.add_task(_send_many, items)
    return {"threshold": threshold, "count": len(targets), "queued": (not body.dry_run) and bool(items), "students": targets}


@router.post("/absence")
def alert_absent(body: AbsenceBody, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Alert every active student with no attendance record on that date."""
    day = body.target_date or datetime.now().date()
    present = {sid for (sid,) in db.query(Attendance.student_id).filter(Attendance.date == day).all()}
    if not present:
        raise HTTPException(status_code=400, detail=f"No attendance was recorded on {day}, so nobody can be marked absent.")
    targets, items = [], []
    for st in db.query(Student).filter(Student.is_active == True).all():
        if st.id in present:
            continue
        targets.append({"student_id": st.student_id, "name": st.name, "channels": _channels(st)})
        subject, text = absence_message(st, "today's attendance", day.strftime("%d %b %Y"))
        items.append((st.id, "absence", subject, text))
    if not body.dry_run and items:
        background.add_task(_send_many, items)
    return {"date": day.isoformat(), "count": len(targets), "queued": (not body.dry_run) and bool(items), "students": targets}


@router.post("/custom")
def send_custom(body: CustomBody, db: Session = Depends(get_db)):
    st = db.query(Student).filter(Student.id == body.student_id, Student.is_active == True).first()
    if not st:
        raise HTTPException(status_code=404, detail="Student not found")
    return notify_student(db, st, "custom", body.subject, body.message)
