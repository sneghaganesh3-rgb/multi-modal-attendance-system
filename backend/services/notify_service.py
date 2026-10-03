"""
Email / SMS alerts. Every attempt is logged in the `notifications` table.

Configure in backend/.env (all optional - without them alerts are logged as "skipped"):
  SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_TLS (1)
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
"""

import base64
import logging
import os
import smtplib
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage

from sqlalchemy.orm import Session

from database.connection import SessionLocal
from database.models import Notification, Student

logger = logging.getLogger(__name__)


def _send_email(to: str, subject: str, body: str):
    host = os.getenv("SMTP_HOST")
    if not host:
        raise RuntimeError("Email is not configured (set SMTP_HOST in backend/.env)")
    msg = EmailMessage()
    msg["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "attendance@localhost"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if os.getenv("SMTP_TLS", "1") != "0":
            smtp.starttls()
        if os.getenv("SMTP_USER"):
            smtp.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(msg)


def _send_sms(to: str, body: str):
    sid, token, sender = os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN"), os.getenv("TWILIO_FROM")
    if not (sid and token and sender):
        raise RuntimeError("SMS is not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM in backend/.env)")
    data = urllib.parse.urlencode({"To": to, "From": sender, "Body": body}).encode()
    req = urllib.request.Request(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode())
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"SMS provider error {e.code}: {e.read()[:200].decode(errors='ignore')}")


def _log(db: Session, student_id, channel, kind, recipient, subject, body, status, error=None):
    db.add(Notification(student_id=student_id, channel=channel, kind=kind, recipient=recipient,
                        subject=subject, body=body, status=status, error=error))
    db.commit()


def notify_student(db: Session, student: Student, kind: str, subject: str, body: str) -> dict:
    """Send by every channel the student has a contact for. Never raises."""
    out = {"student": student.name, "email": None, "sms": None}
    for channel, recipient in (("email", student.email), ("sms", student.phone)):
        if not recipient:
            continue
        try:
            if channel == "email":
                _send_email(recipient, subject, body)
            else:
                _send_sms(recipient, f"{subject}: {body}")
            _log(db, student.id, channel, kind, recipient, subject, body, "sent")
            out[channel] = "sent"
        except RuntimeError as e:
            _log(db, student.id, channel, kind, recipient, subject, body, "skipped", str(e))
            out[channel] = "skipped"
        except Exception as e:
            logger.warning("Notification to %s failed: %s", recipient, e)
            _log(db, student.id, channel, kind, recipient, subject, body, "failed", str(e))
            out[channel] = "failed"
    if out["email"] is None and out["sms"] is None:
        _log(db, student.id, "email", kind, None, subject, body, "skipped", "Student has no email or phone")
        out["email"] = "skipped"
    return out


def absence_message(student: Student, title: str, when: str):
    return (f"Absence alert: {student.name}",
            f"Dear {student.name}, you were marked ABSENT for '{title}' ({when}). "
            f"If this is a mistake, please contact your department.")


def low_attendance_message(student: Student, pct: float, threshold: float):
    return (f"Low attendance: {student.name}",
            f"Dear {student.name}, your attendance is {pct:.1f}%, below the required {threshold:.0f}%. "
            f"Please attend regularly.")


def notify_absentees_background(session_id: int):
    """Runs in a background task with its own DB session."""
    from database.models import AttendanceSession
    from services.session_service import absentees
    db = SessionLocal()
    try:
        s = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
        if not s:
            return
        when = s.start_time.strftime("%d %b %Y %H:%M")
        for st in absentees(db, s):
            subject, body = absence_message(st, s.title, when)
            notify_student(db, st, "absence", subject, body)
    finally:
        db.close()
