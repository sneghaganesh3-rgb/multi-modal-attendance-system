from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database.connection import get_db
from database.models import Admin
from utils.security import verify_password, create_access_token, decode_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

def get_current_admin(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username = payload.get("sub")
    if payload.get("role") == "student":     # student portal tokens are never admin tokens
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    admin = db.query(Admin).filter(Admin.username == username, Admin.is_active == True).first()
    if admin is None:
        raise HTTPException(status_code=401, detail="User not found")
    return admin

@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    admin = db.query(Admin).filter(Admin.username == form_data.username).first()
    if not admin or not verify_password(form_data.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": admin.username})
    return {"access_token": access_token, "token_type": "bearer", "admin": {"id": admin.id, "username": admin.username, "email": admin.email}}

@router.get("/me")
def read_users_me(current_admin: Admin = Depends(get_current_admin)):
    return {"id": current_admin.id, "username": current_admin.username, "email": current_admin.email, "is_active": current_admin.is_active}

@router.post("/logout")
def logout():
    return {"message": "Successfully logged out"}
