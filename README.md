# 🎓 Multi-Modal Attendance System

A biometric attendance management system that combines **face recognition**, **palm biometrics** (left & right hand) and **fingerprint authentication** (WebAuthn: Windows Hello / Touch ID / Android) using score-level fusion, with server-side liveness checks to resist photo and replay spoofing.

> ⚠️ **Privacy notice.** This project processes biometric data (face embeddings, palm templates, WebAuthn credentials). If you deploy it with real people, make sure you have their consent and comply with the biometric/data-protection laws that apply to you (e.g. GDPR, BIPA). The repository contains **no** personal data; your local `backend/attendance.db` is git-ignored.

---

## 🌟 Features

- **Multi-modal score fusion** — Face (45%) + Fingerprint (35%) + Palm (20%) → weighted score; `≥ 0.60` is verified. Weights and thresholds are editable at runtime in *Settings*.
- **Face recognition** — FaceNet (`facenet-pytorch`, InceptionResnetV1 / VGGFace2, MTCNN) 512-D embeddings; 3-shot enrollment, best-template matching, adaptive learning from verified attendance.
- **Palm biometrics** — MediaPipe Hands, 3D canonical normalization, 48-D anthropometric morphology (digit ratios incl. 2D:4D, phalanx proportions, …) plus a 128-D palm-crease texture descriptor. Hand-side-aware duplicate-enrollment prevention.
- **Fingerprint** — WebAuthn platform authenticator; the server verifies the signed assertion (no scanner SDK needed).
- **Liveness / anti-spoofing** — server-issued challenge (random head-turn + blink) verified on a burst of frames with MediaPipe FaceMesh; passive flat/over-exposed/moiré checks; palm stability hold.
- **Safer decisions** — a clearly wrong modality vetoes the match, a lone modality needs a higher score, near-identical matches are reported as *ambiguous*.
- **Class sessions** — open/close timed sessions with grace period; optional "attendance only inside an open session".
- **Student self-service portal** — students log in to see their own attendance.
- **Notifications** — low-attendance and absence alerts by email (SMTP) or SMS (Twilio), both optional.
- **Reports** — daily / weekly / monthly / per-student, exportable to CSV and PDF.
- **Zero-setup database** — SQLite via SQLAlchemy; tables are created automatically on first start.

---

## 🖥️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, Recharts, Axios, MediaPipe Tasks Vision |
| Backend | Python 3.10+, FastAPI, Uvicorn, SQLAlchemy |
| Database | SQLite (`backend/attendance.db`, created on first run) |
| Face AI | `facenet-pytorch` (InceptionResnetV1, MTCNN), PyTorch |
| Palm / liveness | MediaPipe, OpenCV, NumPy, SciPy |
| Fingerprint | WebAuthn (`navigator.credentials`), `cryptography` |
| Auth | JWT (`python-jose`), bcrypt (`passlib`) |
| Reports | ReportLab (PDF), CSV |

---

## 📋 Prerequisites

- **Python 3.10 or 3.11** (pinned dependencies — `mediapipe 0.10.14` / `torch 2.2.2` do not support newer Pythons)
- **Node.js 18+** and npm
- A **webcam**; for fingerprint, a device with Windows Hello / Touch ID / Android biometrics
- Internet on first run: FaceNet weights are downloaded by `facenet-pytorch`, and the browser loads MediaPipe WASM/models from `cdn.jsdelivr.net` and `storage.googleapis.com`
- Camera and WebAuthn require a **secure context** — use `http://localhost` (as below) or HTTPS

---

## 🚀 Installation

```bash
git clone <your-repo-url>
cd <repo-folder>
```

### 1. Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate          # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt

copy .env.example .env           # macOS/Linux: cp .env.example .env
```

Edit `backend/.env` and set at least:

```ini
# python -c "import secrets; print(secrets.token_urlsafe(48))"
SECRET_KEY=<random string>
ADMIN_PASSWORD=<password for the first-run admin account>
```

### 2. Frontend

```bash
cd frontend
npm install
```

---

## ▶️ Running

**Windows one-click:** double-click `start_servers.bat` (expects `backend/venv` and `frontend/node_modules` from the steps above).

**Manually** (two terminals):

```powershell
# Terminal 1 – backend
cd backend
.\venv\Scripts\activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 – frontend
cd frontend
npm run dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://127.0.0.1:8000 |
| Swagger docs | http://127.0.0.1:8000/docs |
| Student portal | http://localhost:5173/portal/login |

Vite proxies `/api` to the backend (see `frontend/vite.config.js`).

---

## 🔑 First Login

- **Username:** `admin`
- **Password:** the `ADMIN_PASSWORD` from `backend/.env`. If you left it empty, a random password is generated and printed **once** in the backend console on first start — copy it from there.

`ADMIN_PASSWORD` is only read when the admin account is first created. To change it later, delete `backend/attendance.db` (this wipes all data) or update the hash in the `admins` table.

---

## ⚙️ Configuration (`backend/.env`)

See [`backend/.env.example`](backend/.env.example) for the full list.

| Variable | Purpose | Default |
|---|---|---|
| `SECRET_KEY` | JWT signing key. **Set this.** If empty a random key is used per run (logins reset on restart). | random |
| `ADMIN_PASSWORD` | Password for the seeded `admin` user | random (printed once) |
| `DATABASE_URL` | SQLAlchemy URL | `sqlite:///./attendance.db` |
| `CORS_ORIGINS` | Comma-separated allowed origins (also the WebAuthn origin) | `http://localhost:5173` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime | `480` |
| `FACE_/PALM_/FINGERPRINT_/FUSION_THRESHOLD` | Initial matching thresholds | `0.50 / 0.70 / 0.75 / 0.60` |
| `FACE_/FINGERPRINT_/PALM_WEIGHT` | Initial fusion weights (sum to 1.0) | `0.45 / 0.35 / 0.20` |
| `SMTP_*`, `TWILIO_*` | Optional email / SMS notifications | unset |

Thresholds, weights and accuracy options are seeded into the database on first run and can afterwards be changed from **Settings** in the UI.

---

## 💡 How Verification Works

```
                     ┌──────────────────┐
                     │ Live Video Feed  │
                     └─────────┬────────┘
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
  [ Face burst ]          [ Hand crop ]         [ Fingerprint ]
       │                       │                       │
  Liveness check         3D normalization        WebAuthn assertion
  FaceNet (512-D)        48-D morphology         (signature verified)
       │                 + crease texture              │
       ▼                       ▼                       ▼
  Face score (45%)       Palm score (20%)      Fingerprint (35%)
       └───────────────────────┼───────────────────────┘
                               ▼
                   Weighted fusion score
                               │
                       Score ≥ 0.60 ?
                       ├── YES ──> ✅ Marked present
                       └── NO  ──> ❌ Rejected
```

Details of the anti-spoofing design and its limits are in [`docs/USAGE.md`](docs/USAGE.md#accuracy--anti-spoofing). A webcam-only system cannot stop a determined attacker with a live deepfake or a 3D mask.

---

## 📁 Project Structure

```
.
├── start_servers.bat            # Windows launcher for both servers
├── README.md
├── docs/
│   ├── SETUP.md                 # Setup & operations guide
│   ├── USAGE.md                 # Feature walkthrough
│   └── API.md                   # REST API reference
├── database/
│   └── schema.sql               # Reference SQLite schema (generated from the models)
├── backend/
│   ├── main.py                  # FastAPI app, startup seeding & light migrations
│   ├── requirements.txt
│   ├── .env.example
│   ├── database/                # connection.py, models.py
│   ├── routers/                 # auth, students, enrollment, attendance, sessions,
│   │                            # portal, notifications, reports, settings
│   ├── services/                # face, palm, fusion, liveness, webauthn,
│   │                            # session, attendance_stats, notify
│   └── utils/                   # security (JWT/bcrypt), export (CSV/PDF)
└── frontend/
    ├── package.json, vite.config.js, tailwind.config.js
    └── src/
        ├── api/                 # axios clients (admin + portal)
        ├── components/          # webcam capture, layout, navbar, …
        ├── pages/               # Dashboard, Students, Enrollment, Attendance,
        │                        # Sessions, Notifications, Reports, Settings, Portal
        └── utils/webauthn.js
```

---

## 🛠️ Administration Workflow

1. **Students** → add a student profile.
2. Open the student → enroll **Face**, **Palm** (left/right) and/or **Fingerprint**.
3. (Optional) **Sessions** → open a timed class session.
4. **Mark Attendance** → run the biometric capture; the fused result is stored.
5. **Reports** → filter and export CSV / PDF.
6. (Optional) give students portal access from their profile.

---

## 🧪 Troubleshooting

| Problem | Fix |
|---|---|
| `pip install` fails on `mediapipe`/`torch` | Use Python 3.10 or 3.11 |
| Camera won't open | Allow camera permission for `http://localhost:5173`; use localhost or HTTPS |
| Fingerprint option unavailable | Needs a platform authenticator; `CORS_ORIGINS` must match the URL you open |
| Logged out after every backend restart | Set a fixed `SECRET_KEY` in `backend/.env` |
| Port 8000 / 5173 busy | Stop the other process or change the port |

---

## 🔒 Security Notes

- Never commit `backend/.env` or `backend/attendance.db` (both are git-ignored).
- Change the default admin password and set a strong `SECRET_KEY`.
- Run behind HTTPS and restrict `CORS_ORIGINS` for any non-local deployment.

---

## 📄 License

Released under the [MIT License](LICENSE).
