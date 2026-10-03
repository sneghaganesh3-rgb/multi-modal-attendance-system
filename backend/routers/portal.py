"""Student self-service portal: a student logs in and sees only their own attendance."""

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.connection import get_db
from database.models import Student, Attendance
from routers.auth import get_current_admin, oauth2_scheme
from utils.security import hash_password, verify_password, create_access_token, decode_access_token
from services.attendance_stats import student_summary

router = APIRouter(prefix="/portal", tags=["portal"])


class PortalLogin(BaseModel):
    student_id: str
    password: str


class PasswordSet(BaseModel):
    password: str | None = None      # omit to generate a random temporary password


def get_current_student(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Student:
    payload = decode_access_token(token)
    if not payload or payload.get("role") != "student":
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    student = db.query(Student).filter(Student.id == payload.get("sid"), Student.is_active == True).first()
    if student is None:
        raise HTTPException(status_code=401, detail="Student not found")
    return student


def _public(s: Student) -> dict:
    return {"id": s.id, "student_id": s.student_id, "name": s.name, "department": s.department,
            "year": s.year, "section": s.section}


@router.post("/login")
def portal_login(body: PortalLogin, db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.student_id == body.student_id.strip(), Student.is_active == True).first()
    if not student or not student.portal_password_hash or not verify_password(body.password, student.portal_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect student ID or password")
    token = create_access_token(data={"sub": f"student:{student.id}", "role": "student", "sid": student.id})
    return {"access_token": token, "token_type": "bearer", "student": _public(student)}


@router.get("/me")
def portal_me(student: Student = Depends(get_current_student)):
    return _public(student)


@router.get("/attendance")
def portal_attendance(student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    summary = student_summary(db, student)
    records = (db.query(Attendance).filter(Attendance.student_id == student.id)
               .order_by(Attendance.date.desc(), Attendance.time_in.desc()).limit(200).all())
    return {
        "student": _public(student),
        **summary,
        "records": [{
            "date": r.date.isoformat(), "time_in": str(r.time_in), "status": r.status,
            "session": r.session_id,
        } for r in records],
    }


@router.post("/admin/set-password/{student_id}")
def set_portal_password(student_id: int, body: PasswordSet, db: Session = Depends(get_db),
                        _=Depends(get_current_admin)):
    """Admin gives a student portal access. Returns the password once (it is stored hashed)."""
    student = db.query(Student).filter(Student.id == student_id, Student.is_active == True).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    password = body.password
    if password is not None and len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not password:
        alphabet = string.ascii_letters + string.digits
        password = "".join(secrets.choice(alphabet) for _ in range(10))
    student.portal_password_hash = hash_password(password)
    db.commit()
    return {"student_id": student.student_id, "name": student.name, "password": password}
