import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load backend/.env no matter which folder the server is started from
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

# Use SQLite by default — no installation needed!
# DB file is always backend/attendance.db, whatever the working directory is
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./attendance.db"
)
if DATABASE_URL.startswith("sqlite:///./"):
    DATABASE_URL = "sqlite:///" + os.path.join(BACKEND_DIR, DATABASE_URL[len("sqlite:///./"):]).replace("\\", "/")

# SQLite needs check_same_thread=False for FastAPI
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
