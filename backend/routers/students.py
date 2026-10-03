from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel, EmailStr

from database.connection import get_db
from database.models import Student, FaceTemplate, PalmTemplate, FingerprintTemplate
from routers.auth import get_current_admin

router = APIRouter(prefix="/students", tags=["students"])


class StudentCreate(BaseModel):
    student_id: str
    name: str
    department: str
    year: int
    section: str
    email: Optional[str] = None       # optional — not every student has college email
    phone: Optional[str] = None


class StudentUpdate(BaseModel):
    name:       Optional[str] = None
    department: Optional[str] = None
    year:       Optional[int] = None
    section:    Optional[str] = None
    email:      Optional[str] = None
    phone:      Optional[str] = None


def student_to_dict(s: Student) -> dict:
    """Convert a Student ORM object to a plain dict safe for JSON response."""
    return {
        "id":         s.id,
        "student_id": s.student_id,
        "name":       s.name,
        "department": s.department,
        "year":       s.year,
        "section":    s.section,
        "email":      s.email,
        "phone":      s.phone,
        "is_active":  s.is_active,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/")
def get_students(
    skip:   int            = 0,
    limit:  int            = 200,
    search: Optional[str]  = None,
    db:     Session        = Depends(get_db),
    _:                     None = Depends(get_current_admin),
):
    """List all active students, optionally filtered by search term."""
    query = db.query(Student).filter(Student.is_active == True)
    if search:
        like = f"%{search}%"
        query = query.filter(
            Student.name.ilike(like) |
            Student.student_id.ilike(like) |
            Student.department.ilike(like)
        )
    students = query.offset(skip).limit(limit).all()
    return [student_to_dict(s) for s in students]


@router.post("/")
def create_student(
    student: StudentCreate,
    db:      Session = Depends(get_db),
    _:       None    = Depends(get_current_admin),
):
    """Create a new student. student_id must be unique."""
    existing = db.query(Student).filter(Student.student_id == student.student_id).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Student ID '{student.student_id}' is already registered.")

    new_student = Student(
        student_id=student.student_id,
        name=student.name,
        department=student.department,
        year=student.year,
        section=student.section,
        email=student.email if student.email else None,
        phone=student.phone if student.phone else None,
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)
    return student_to_dict(new_student)


@router.get("/{student_id}")
def get_student(
    student_id: int,
    db:         Session = Depends(get_db),
    _:          None    = Depends(get_current_admin),
):
    """Get a single student by their internal DB id."""
    student = db.query(Student).filter(Student.id == student_id, Student.is_active == True).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student_to_dict(student)


@router.put("/{student_id}")
def update_student(
    student_id:     int,
    student_update: StudentUpdate,
    db:             Session = Depends(get_db),
    _:              None    = Depends(get_current_admin),
):
    """Update a student's details."""
    db_student = db.query(Student).filter(Student.id == student_id, Student.is_active == True).first()
    if not db_student:
        raise HTTPException(status_code=404, detail="Student not found")

    update_data = student_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_student, key, value)

    db.commit()
    db.refresh(db_student)
    return student_to_dict(db_student)


@router.delete("/{student_id}")
def delete_student(
    student_id: int,
    db:         Session = Depends(get_db),
    _:          None    = Depends(get_current_admin),
):
    """Soft-delete a student (marks is_active=False)."""
    db_student = db.query(Student).filter(Student.id == student_id).first()
    if not db_student:
        raise HTTPException(status_code=404, detail="Student not found")

    db_student.is_active = False
    db.commit()
    return {"message": "Student deactivated successfully"}


@router.get("/{student_id}/enrollment-status")
def get_enrollment_status(
    student_id: int,
    db:         Session = Depends(get_db),
    _:          None    = Depends(get_current_admin),
):
    """Check which biometric modalities are enrolled for a student."""
    face       = db.query(FaceTemplate).filter(FaceTemplate.student_id == student_id).first()
    palm_right = db.query(PalmTemplate).filter(PalmTemplate.student_id == student_id, PalmTemplate.hand_side == "right").first()
    palm_left  = db.query(PalmTemplate).filter(PalmTemplate.student_id == student_id, PalmTemplate.hand_side == "left").first()
    fp         = db.query(FingerprintTemplate).filter(FingerprintTemplate.student_id == student_id).first()

    return {
        "student_id":  student_id,
        "face":        face        is not None,
        "palm":        (palm_right is not None) or (palm_left is not None),
        "palm_right":  palm_right  is not None,
        "palm_left":   palm_left   is not None,
        "fingerprint": fp          is not None,
    }
