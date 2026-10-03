# Setup & Operation Guide — Multi-Modal Attendance System

This guide outlines the system setup, architecture, and daily operations for the **Multi-Modal Attendance System**.

---

## ⚡ Quick Start (Windows)

See the [README](../README.md#-installation) for first-time installation (venv, `pip install`, `npm install`, `.env`).

### 1-Click Launch:
Double-click the startup script in the project root:
```
start_servers.bat
```
This automatically starts:
1. **Backend Server**: FastAPI on `http://127.0.0.1:8000`
2. **Frontend Server**: Vite dev server on `http://localhost:5173`
3. Automatically opens `http://localhost:5173` in your default browser.

---

## 🔑 Login Information

- **Portal URL**: [http://localhost:5173](http://localhost:5173)
- **Username**: `admin`
- **Password**: the value of `ADMIN_PASSWORD` in `backend/.env` (if unset, a random one is printed in the backend console on first start)
- **Swagger API Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## 🗄️ Database Architecture

The system uses an embedded **SQLite** database (`backend/attendance.db`).
- **Zero Configuration**: No external database servers (like MySQL) need to be installed or maintained.
- **SQLAlchemy ORM**: Full ACID-compliant relational storage with cascading foreign keys.
- **Tables Included**:
  - `admins`: Administrative accounts and hashed passwords.
  - `students`: Student profile details, department, section, and contact info.
  - `face_templates`: 512-dimensional FaceNet embeddings and quality scores.
  - `palm_templates`: Hand-side specific 3D anthropometric biometric models and crease descriptors.
  - `fingerprint_templates`: WebAuthn platform credential tokens.
  - `attendance`: Multi-modal attendance logs with individual and fused confidence scores.
  - `system_settings`: Real-time configurable matching thresholds and fusion weights.

---

## 🛠️ Manual Startup (Terminal Commands)

If you prefer starting the servers manually from PowerShell or Command Prompt:

### Terminal 1: Backend
```powershell
cd PROJECT\backend

# Activate the virtual environment
.\venv\Scripts\Activate.ps1

# Start the uvicorn server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Terminal 2: Frontend
```powershell
cd PROJECT\frontend

# Start Vite
npm run dev -- --host
```

---

## 🖐️ Advanced Biometric Engine Architecture

### Face Recognition
- **Detector**: MTCNN face detection and multi-face screening.
- **Embedding Model**: FaceNet (`InceptionResnetV1` pre-trained on VGGFace2).
- **Liveness Anti-Spoofing**: Real-time Eye Aspect Ratio (EAR) blink detection prevents static photo attacks.
- **Distance Metric**: Normalized Euclidean distance with calibrated 0.50 threshold.

### Palm Biometrics
- **Pose Normalization**: Canonical 3D hand alignment anchors wrist at $(0,0,0)$ and aligns fingers along an orthonormal coordinate frame, eliminating orientation and camera distance variance.
- **48-D Morphological Biometrics**: Computes individual finger length proportions, 2D:4D digit ratios, phalangeal segment ratios, palm aspect ratio, knuckle dispersion, and inter-fingertip spans.
- **Palm Crease Texture**: Central palm ROI extraction with CLAHE contrast normalization and 128-D multi-scale gradient histograms.
- **Duplicate Prevention**: Calibrated 80% threshold and hand-side isolation prevents duplicate registrations while cleanly accepting new students.

### Fingerprint (Touch ID / Windows Hello)
- Uses the **WebAuthn Platform Authenticator** API.
- Interfaces directly with the device's hardware-backed biometric security enclave.

---

## 🔧 Environment Configuration (`backend/.env`)

```ini
DATABASE_URL=sqlite:///./attendance.db
# Generate with: python -c "import secrets; print(secrets.token_urlsafe(48))"
SECRET_KEY=<your-random-secret>
ADMIN_PASSWORD=<first-run admin password>
CORS_ORIGINS=http://localhost:5173
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

# Biometric Verification Thresholds
FACE_THRESHOLD=0.50
PALM_THRESHOLD=0.70
FINGERPRINT_THRESHOLD=0.75
FUSION_THRESHOLD=0.60

# Score Fusion Weights (Sum = 1.0)
FACE_WEIGHT=0.45
FINGERPRINT_WEIGHT=0.35
PALM_WEIGHT=0.20
```

---

## ❓ Troubleshooting

| Issue | Resolution |
|---|---|
| Camera not opening in browser | Ensure browser camera permissions are set to "Allow" for `http://localhost:5173`. |
| Port 8000 or 5173 in use | Close existing console windows running uvicorn or Vite, or restart using `start_servers.bat`. |
| PowerShell Execution Policy Error | Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` in PowerShell once. |
| Fingerprint sensor not available | If the machine lacks a Windows Hello / Touch ID sensor, students can verify using Face + Palm. |
