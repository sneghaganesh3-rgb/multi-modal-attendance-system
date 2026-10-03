"""Attendance sessions: status, who belongs to a session, who is absent."""

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from database.models import AttendanceSession, Attendance, Student


def session_status(s: AttendanceSession, now: Optional[datetime] = None) -> str:
    now = now or datetime.now()
    if s.closed_at is not None or now >= s.end_time:
        return "closed"
    if now < s.start_time:
        return "upcoming"
    return "open"


def in_scope(s: AttendanceSession, student: Student) -> bool:
    if s.department and s.department.strip().lower() != (student.department or "").strip().lower():
        return False
    if s.year is not None and s.year != student.year:
        return False
    if s.section and s.section.strip().lower() != (student.section or "").strip().lower():
        return False
    return True


def students_in_scope(db: Session, s: AttendanceSession) -> list:
    return [st for st in db.query(Student).filter(Student.is_active == True).all() if in_scope(s, st)]


def late_cutoff(s: AttendanceSession) -> datetime:
    return s.start_time + timedelta(minutes=s.grace_minutes or 0)


def absentees(db: Session, s: AttendanceSession) -> list:
    present = {sid for (sid,) in db.query(Attendance.student_id).filter(Attendance.session_id == s.id).all()}
    return [st for st in students_in_scope(db, s) if st.id not in present]


def session_to_dict(db: Session, s: AttendanceSession) -> dict:
    status = session_status(s)
    marked = db.query(Attendance).filter(Attendance.session_id == s.id).all()
    return {
        "id": s.id,
        "title": s.title,
        "department": s.department,
        "year": s.year,
        "section": s.section,
        "start_time": s.start_time.isoformat(),
        "end_time": s.end_time.isoformat(),
        "grace_minutes": s.grace_minutes,
        "status": status,
        "closed_at": s.closed_at.isoformat() if s.closed_at else None,
        "expected": len(students_in_scope(db, s)),
        "present": sum(1 for a in marked if a.status == "present"),
        "late": sum(1 for a in marked if a.status == "late"),
    }
