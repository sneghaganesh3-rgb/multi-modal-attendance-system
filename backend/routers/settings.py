from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List

from database.connection import get_db
from database.models import SystemSetting
from routers.auth import get_current_admin

router = APIRouter(prefix="/settings", tags=["settings"])

class SettingItem(BaseModel):
    key: str
    value: str

@router.get("/")
def get_settings(db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    settings = db.query(SystemSetting).all()
    return [{"key": s.key, "value": s.value, "description": s.description} for s in settings]

@router.put("/")
def update_settings(settings: List[SettingItem], db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    for item in settings:
        db_setting = db.query(SystemSetting).filter(SystemSetting.key == item.key).first()
        if db_setting:
            db_setting.value = item.value
    db.commit()
    return {"message": "Settings updated successfully"}

from database.models import Notification, Student, Attendance, FaceTemplate, PalmTemplate, FingerprintTemplate
@router.delete("/wipe-data")
def wipe_all_data(db: Session = Depends(get_db), current_admin = Depends(get_current_admin)):
    # Delete child records first to avoid foreign key constraints
    db.query(Notification).delete()
    db.query(Attendance).delete()
    db.query(FaceTemplate).delete()
    db.query(PalmTemplate).delete()
    db.query(FingerprintTemplate).delete()
    # Delete all students
    db.query(Student).delete()
    db.commit()
    return {"message": "All student and attendance data has been completely wiped."}
