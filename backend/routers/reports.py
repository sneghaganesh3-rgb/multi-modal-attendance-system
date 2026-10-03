from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta
from typing import Optional

from database.connection import get_db
from database.models import Attendance, Student
from utils.export import generate_csv, generate_pdf
from routers.auth import get_current_admin

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(get_current_admin)])

def get_report_data(db: Session, date_from: Optional[date] = None, date_to: Optional[date] = None, department: Optional[str] = None):
    query = db.query(Attendance).join(Student)
    if date_from:
        query = query.filter(Attendance.date >= date_from)
    if date_to:
        query = query.filter(Attendance.date <= date_to)
    if department:
        query = query.filter(Student.department == department)
        
    records = query.all()
    return [{
        "Student ID": r.student.student_id,
        "Name": r.student.name,
        "Department": r.student.department,
        "Date": str(r.date),
        "Time In": str(r.time_in),
        "Status": r.status,
        "Method": r.verification_method
    } for r in records]

@router.get("/daily")
def daily_report(target_date: date = None, db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    if not target_date:
        target_date = datetime.now().date()
    return get_report_data(db, date_from=target_date, date_to=target_date)

@router.get("/weekly")
def weekly_report(week_start: date = None, db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    if not week_start:
        week_start = datetime.now().date() - timedelta(days=datetime.now().date().weekday())
    week_end = week_start + timedelta(days=6)
    return get_report_data(db, date_from=week_start, date_to=week_end)

@router.get("/monthly")
def monthly_report(year: int, month: int, db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)
    return get_report_data(db, date_from=start_date, date_to=end_date)

@router.get("/student/{student_id}")
def student_report(student_id: int, db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    records = db.query(Attendance).filter(Attendance.student_id == student_id).order_by(Attendance.date.desc()).all()
    return [{
        "date": str(r.date),
        "time_in": str(r.time_in),
        "status": r.status,
        "method": r.verification_method
    } for r in records]

@router.get("/export/csv")
def export_csv(
    date_from: Optional[date] = None, 
    date_to: Optional[date] = None, 
    department: Optional[str] = None,
    db: Session = Depends(get_db)
):
    data = get_report_data(db, date_from, date_to, department)
    csv_bytes = generate_csv(data, "report.csv")
    return Response(content=csv_bytes, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=report.csv"})

@router.get("/export/pdf")
def export_pdf(
    date_from: Optional[date] = None, 
    date_to: Optional[date] = None, 
    department: Optional[str] = None,
    db: Session = Depends(get_db)
):
    data = get_report_data(db, date_from, date_to, department)
    pdf_bytes = generate_pdf(data, "Attendance Report", "report.pdf")
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=report.pdf"})

@router.get("/summary")
def summary_report(db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    total_students = db.query(Student).filter(Student.is_active == True).count()
    total_attendances = db.query(Attendance).count()
    # Simple overall rate based on total expected if we just use a basic metric
    return {
        "total_students": total_students,
        "total_attendance_records_logged": total_attendances
    }
