import os
import secrets
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import inspect, text
from database.connection import engine, Base, SessionLocal
from database.models import Admin, SystemSetting, FingerprintTemplate
from utils.security import hash_password
from services.webauthn_service import parse_template

from routers import auth, students, enrollment, attendance, reports, settings, sessions, portal, notifications

logger = logging.getLogger(__name__)

# Comma-separated list in .env; defaults to the local Vite dev server.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    ).split(",") if o.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    on_startup()
    yield


app = FastAPI(title="Multi-Modal Attendance System API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(students.router, prefix="/api")
app.include_router(enrollment.router, prefix="/api")
app.include_router(attendance.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(portal.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")

def _migrate():
    """Add columns introduced after the first release (create_all never alters tables)."""
    insp = inspect(engine)
    adds = [
        ("face_templates", "source", "VARCHAR(20) NOT NULL DEFAULT 'enroll'"),
        ("attendance", "session_id", "INTEGER"),
        ("students", "portal_password_hash", "VARCHAR(255)"),
    ]
    for table, col, ddl in adds:
        if col not in {c["name"] for c in insp.get_columns(table)}:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


def on_startup():
    Base.metadata.create_all(bind=engine)
    _migrate()
    
    db = SessionLocal()
    try:
        # Seed Admin
        admin = db.query(Admin).filter(Admin.username == "admin").first()
        if not admin:
            admin_password = os.getenv("ADMIN_PASSWORD")
            if not admin_password:
                admin_password = secrets.token_urlsafe(12)
                # Shown once; set ADMIN_PASSWORD in backend/.env to choose your own.
                print(f"ADMIN_PASSWORD not set. Generated admin password: {admin_password}", flush=True)
            new_admin = Admin(
                username="admin",
                email="admin@attendance.local",
                password_hash=hash_password(admin_password)
            )
            db.add(new_admin)
            
        # Drop legacy fingerprint rows (old simulated / bare credential-id format)
        for t in db.query(FingerprintTemplate).all():
            if parse_template(t.template) is None:
                db.delete(t)

        # Seed Settings
        default_settings = [
            ("FACE_THRESHOLD", "0.50", "Face threshold"),
            ("PALM_THRESHOLD", "0.70", "Palm threshold"),
            ("FINGERPRINT_THRESHOLD", "0.75", "Fingerprint threshold"),
            ("FUSION_THRESHOLD", "0.60", "Fusion threshold"),
            ("FACE_WEIGHT", "0.45", "Face weight"),
            ("FINGERPRINT_WEIGHT", "0.35", "Fingerprint weight"),
            ("PALM_WEIGHT", "0.20", "Palm weight"),
            ("LIVENESS_REQUIRED", "1", "Require server-side face liveness (1=yes, 0=no)"),
            ("SINGLE_MODALITY_MARGIN", "0.10", "Extra score a lone modality needs above its threshold"),
            ("AMBIGUITY_MARGIN", "0.05", "Reject when the runner-up is closer than this to the best match"),
            ("ADAPTIVE_ENROLL", "1", "Learn new face samples from verified attendance (1=yes, 0=no)"),
            ("ADAPTIVE_MIN_FACE", "0.75", "Minimum face score to learn a new face sample"),
            ("SESSION_REQUIRED", "0", "Only allow marking attendance inside an open session (1=yes, 0=no)"),
            ("LOW_ATTENDANCE_THRESHOLD", "75", "Alert students whose attendance % is below this"),
            ("NOTIFY_ON_SESSION_CLOSE", "0", "Email/SMS absent students when a session closes (1=yes, 0=no)")
        ]
        
        for k, v, d in default_settings:
            s = db.query(SystemSetting).filter(SystemSetting.key == k).first()
            if not s:
                db.add(SystemSetting(key=k, value=v, description=d))
                
        db.commit()
    finally:
        db.close()

@app.get("/")
def read_root():
    return {"message": "Welcome to Multi-Modal Attendance System API", "docs": "/docs"}
