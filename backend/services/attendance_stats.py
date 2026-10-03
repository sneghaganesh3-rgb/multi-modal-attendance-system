"""
Attendance percentage per student.

A "class day" is any date on which attendance was taken for the student's group:
  - a date on which anyone has an attendance record, or
  - the start date of an attendance session that includes the student.
Only days from the day the student was added count. A day is present if the
student has a present or late record that day, otherwise absent.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from database.models import Attendance, AttendanceSession, Student
from services.session_service import in_scope


def _created_date(student: Student) -> Optional[date]:
    return student.created_at.date() if student.created_at else None


def class_days(db: Session, student: Student) -> list:
    days = {d for (d,) in db.query(Attendance.date).distinct().all() if d}
    for s in db.query(AttendanceSession).all():
        if in_scope(s, student) and s.start_time <= datetime.now():
            days.add(s.start_time.date())
    start = _created_date(student)
    own = {d for (d,) in db.query(Attendance.date).filter(Attendance.student_id == student.id).all()}
    days |= own
    return sorted(d for d in days if start is None or d >= start or d in own)


def student_summary(db: Session, student: Student) -> dict:
    records = db.query(Attendance).filter(Attendance.student_id == student.id).all()
    by_day = {}
    for r in records:
        # present beats late beats anything else when there are several records in a day
        rank = {"present": 2, "late": 1}.get(r.status, 0)
        if r.date not in by_day or rank > by_day[r.date][0]:
            by_day[r.date] = (rank, r.status)

    days = class_days(db, student)
    present = sum(1 for d in days if by_day.get(d, (0,))[0] == 2)
    late = sum(1 for d in days if by_day.get(d, (0,))[0] == 1)
    total = len(days)
    pct = round(100.0 * (present + late) / total, 1) if total else None
    return {
        "total_days": total,
        "present": present,
        "late": late,
        "absent": total - present - late,
        "percentage": pct,
        "days": [{"date": d.isoformat(), "status": by_day[d][1] if d in by_day else "absent"} for d in days],
    }
