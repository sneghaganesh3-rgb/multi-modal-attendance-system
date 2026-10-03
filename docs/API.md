# API Reference — Multi-Modal Attendance System

Base URL: `http://localhost:8000`
Interactive docs: `http://localhost:8000/docs` (Swagger UI)

All protected endpoints require:
```
Authorization: Bearer <jwt_token>
```

The token is obtained from `POST /api/auth/login`.

---

## Authentication

### POST `/api/auth/login`
Login as admin.

**Request body (form data):**
```
username=admin&password=<your-admin-password>
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "admin": {
    "id": 1,
    "username": "admin",
    "email": "admin@attendance.local"
  }
}
```

### GET `/api/auth/me`
Get current admin info. Requires auth.

**Response:**
```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@attendance.local",
  "is_active": true
}
```

### POST `/api/auth/logout`
Logout (client discards token).

---

## Students

### GET `/api/students/`
List all students with optional filters.

**Query params:**
| Param | Type | Description |
|---|---|---|
| `search` | string | Search by name or student_id |
| `department` | string | Filter by department |
| `year` | int | Filter by year |
| `page` | int | Page number (default 1) |
| `per_page` | int | Items per page (default 20) |

**Response:**
```json
{
  "students": [...],
  "total": 42,
  "page": 1,
  "per_page": 20,
  "pages": 3
}
```

### POST `/api/students/`
Create a new student. Requires auth.

**Request body:**
```json
{
  "student_id": "CSE2024010",
  "name": "John Doe",
  "department": "CSE",
  "year": 1,
  "section": "A",
  "email": "john@college.edu",
  "phone": "9876543210"
}
```

### GET `/api/students/{student_id}`
Get a single student by their internal DB `id`.

**Response includes:**
```json
{
  "id": 1,
  "student_id": "CSE2024001",
  "name": "Arun Kumar",
  ...
  "enrollment_status": {
    "face": true,
    "palm": false,
    "fingerprint": true
  }
}
```

### PUT `/api/students/{student_id}`
Update student details. Requires auth.

### DELETE `/api/students/{student_id}`
Soft-delete (deactivate) a student. Requires auth.

### GET `/api/students/{student_id}/enrollment-status`
Check which biometric modalities are enrolled for a student.

**Response:**
```json
{
  "student_id": 1,
  "face": true,
  "palm": false,
  "fingerprint": true
}
```

---

## Enrollment

### POST `/api/enrollment/face/{student_id}`
Enroll face templates. Requires auth. A student can hold up to 6 face templates
(enrolled + adaptive); more than one sample makes recognition robust to pose and lighting.

**Request body:**
```json
{
  "images": ["data:image/jpeg;base64,...", "...", "..."],
  "append": false
}
```
- `images` (1-8 photos, 3 recommended: straight / slightly left / slightly right) or the single `image_base64`.
- `append: true` adds to the existing templates; the default replaces them.
- Every photo needs exactly one clear face (>= 80 px wide). Photos in one request must be the same person.
- A face matching another student (>= 85 % similarity) is rejected with `409`.

**Response:**
```json
{ "message": "Face enrolled successfully", "quality_score": 0.99, "photos_used": 3, "templates": 3 }
```

### POST `/api/enrollment/palm/{student_id}`
Enroll palm/hand biometric. Requires auth.

**Request body:** `{ "images": ["data:image/jpeg;base64,...", "...", "..."] }` (or `image_base64`).
Several shots of the same hand are **averaged** into one template. The hand must be fully
in frame, large enough, with fingers open and flat. Left/right is auto-detected.

### GET `/api/enrollment/fingerprint-challenge`
One-time challenge (base64url) for creating the fingerprint credential. Requires auth.

### POST `/api/enrollment/fingerprint/{student_id}`
Enroll a fingerprint created with the device sensor (WebAuthn platform authenticator). Requires auth.

**Request body (all base64url):**
```json
{
  "credential_id": "...",
  "public_key": "... (SPKI DER from getPublicKey())",
  "client_data_json": "..."
}
```

### DELETE `/api/enrollment/face/{student_id}`
Remove face template for student. Requires auth.

### DELETE `/api/enrollment/palm/{student_id}`
Remove palm template for student. Requires auth.

### DELETE `/api/enrollment/fingerprint/{student_id}`
Remove fingerprint template for student. Requires auth.

---

## Attendance

### POST `/api/attendance/verify/face`
Verify identity using face recognition. Requires auth.

**Request body:**
```json
{
  "image_base64": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

**Response (match found):**
```json
{
  "match": true,
  "student_id": 1,
  "student_name": "Arun Kumar",
  "student_code": "CSE2024001",
  "score": 0.87,
  "message": "Face verified successfully",
  "already_marked_today": false
}
```

**Response (no match):**
```json
{
  "match": false,
  "score": 0.31,
  "message": "Face not recognized. Please try again."
}
```

### POST `/api/attendance/verify/palm`
Verify identity using palm recognition. Requires auth.

Same request/response structure as face verification.

### GET `/api/attendance/fingerprint-challenge`
Returns `{ "challenge", "allow_credentials": [...], "enrolled": bool }` for a fingerprint scan. Requires auth.

### GET `/api/attendance/liveness-challenge`
Starts a face liveness check. Returns a one-time `token`, a random head-turn `direction`
(`left`/`right`, as seen on the mirrored preview) and an `instruction`. Valid for 90 s, single use.

### POST `/api/attendance/verify/multimodal`
Fused multi-modal verification + attendance recording. Requires auth.

**Request body:**
```json
{
  "face_frames": ["data:image/jpeg;base64,...", "... (6-24 frames, ~2.5 s)"],
  "liveness_token": "<from /liveness-challenge>",
  "palm_image": "data:image/jpeg;base64,...",
  "fingerprint": {
    "credential_id": "...",
    "authenticator_data": "...",
    "client_data_json": "...",
    "signature": "..."
  }
}
```
- **Face requires a liveness burst.** The server checks, on the frames, that exactly one face is
  present, the person **blinks**, **turns the head in the requested direction**, moves naturally,
  and that the **identity stays the same** through the clip. A still photo, replayed image or
  face swap is rejected (`match: false, spoof_suspected: true`) and nothing is recorded.
  The legacy single `face_image` is only accepted when the setting `LIVENESS_REQUIRED` is `0`.
- `fingerprint` is the signed WebAuthn assertion from the device sensor.
- Any combination is valid (at least one modality). A face alone must clear its threshold by
  `SINGLE_MODALITY_MARGIN` (default 0.10); a modality that clearly contradicts the identity vetoes the match.

**Response (verified):**
```json
{
  "student_id": 1,
  "student_name": "Arun Kumar",
  "match": true,
  "ambiguous": false,
  "already_marked_today": false,
  "liveness": { "live": true, "score": 0.81, "direction": "left", "reason": "Liveness confirmed", "checks": {} },
  "adaptive_template_added": false,
  "fusion_result": {
    "fusion_score": 0.87,
    "confidence": 0.93,
    "decision": "verified",
    "modalities_used": ["face", "palm"],
    "individual_scores": { "face": 0.89, "palm": 0.82 },
    "calibrated": { "face": 0.97, "palm": 0.88 },
    "threshold": 0.6,
    "message": "Identity verified successfully (Score: 87.0% >= Threshold: 60.0%)"
  }
}
```
- `ambiguous: true` (`match: false`): two different students matched within `AMBIGUITY_MARGIN` (0.05); add palm or fingerprint.
- `already_marked_today: true`: attendance was already recorded; nothing new is saved.
- `adaptive_template_added`: a verified face confirmed by palm/fingerprint was stored as a new
  template (max one per student per day; needs `ADAPTIVE_ENROLL=1` and face score >= `ADAPTIVE_MIN_FACE`).

### GET `/api/attendance/`
List attendance records with filters. Requires auth.

**Query params:**
| Param | Type | Description |
|---|---|---|
| `date_from` | date | Start date (YYYY-MM-DD) |
| `date_to` | date | End date (YYYY-MM-DD) |
| `student_id` | int | Filter by student DB ID |
| `department` | string | Filter by department |
| `status` | string | present/late/absent |
| `page` | int | Page number |
| `per_page` | int | Items per page |

### GET `/api/attendance/today`
Get today's attendance records. Requires auth.

### GET `/api/attendance/stats`
Get summary statistics. Requires auth.

**Response:**
```json
{
  "total_students": 50,
  "present_today": 42,
  "absent_today": 8,
  "late_today": 5,
  "attendance_rate": 84.0,
  "last_7_days": [
    {"date": "2024-01-01", "present": 40, "absent": 10, "late": 3},
    ...
  ]
}
```

---

## Reports

### GET `/api/reports/daily`
Daily attendance report. Requires auth.

**Query param:** `date` (YYYY-MM-DD, default today)

### GET `/api/reports/weekly`
Weekly attendance report. Requires auth.

**Query param:** `week_start` (YYYY-MM-DD, Monday of the week)

### GET `/api/reports/monthly`
Monthly attendance report. Requires auth.

**Query params:** `year`, `month`

### GET `/api/reports/student/{student_id}`
Full attendance history for one student. Requires auth.

### GET `/api/reports/export/csv`
Download CSV file. Requires auth.

**Query params:**
- `date_from` (YYYY-MM-DD)
- `date_to` (YYYY-MM-DD)
- `department` (optional)

**Response:** `Content-Type: text/csv` file download

### GET `/api/reports/export/pdf`
Download PDF file. Requires auth.

Same query params as CSV.

**Response:** `Content-Type: application/pdf` file download

### GET `/api/reports/summary`
Overall system statistics. Requires auth.

**Response:**
```json
{
  "total_students": 50,
  "enrolled": {
    "face": 48,
    "palm": 30,
    "fingerprint": 20
  },
  "overall_attendance_rate": 82.5,
  "this_month_records": 1240
}
```

---

## Settings

### GET `/api/settings/`
Get all system settings. Requires auth.

**Response:**
```json
[
  {
    "id": 1,
    "key": "FACE_THRESHOLD",
    "value": "0.50",
    "description": "Minimum face similarity score (0.0-1.0)"
  },
  ...
]
```

### PUT `/api/settings/`
Update one or more settings. Requires auth.

**Request body:**
```json
[
  { "key": "FACE_THRESHOLD", "value": "0.55" },
  { "key": "FUSION_THRESHOLD", "value": "0.65" }
]
```

---

### Accuracy settings (keys in `/api/settings/`)
| Key | Default | Meaning |
|---|---|---|
| `LIVENESS_REQUIRED` | 1 | Require the server-side face liveness check |
| `SINGLE_MODALITY_MARGIN` | 0.10 | Extra score a lone modality needs above its threshold |
| `AMBIGUITY_MARGIN` | 0.05 | Reject when the runner-up student is this close to the best |
| `ADAPTIVE_ENROLL` | 1 | Learn new face samples from verified attendance |
| `ADAPTIVE_MIN_FACE` | 0.75 | Minimum face score to learn a sample |

---

## Sessions (admin)

| Method | Path | Description |
|---|---|---|
| POST | `/api/sessions/` | Create a class session (`title`, optional `department`/`year`/`section`, `duration_minutes`, `grace_minutes`) |
| GET | `/api/sessions/` | List sessions |
| GET | `/api/sessions/open` | Currently open sessions |
| GET | `/api/sessions/{id}` | Session detail with present/absent lists |
| POST | `/api/sessions/{id}/close` | Close a session (optionally notifies absentees) |
| DELETE | `/api/sessions/{id}` | Delete a session |

## Student Portal

| Method | Path | Description |
|---|---|---|
| POST | `/api/portal/login` | Student login (student ID + portal password) |
| GET | `/api/portal/me` | Current student profile |
| GET | `/api/portal/attendance` | Student's own attendance summary and records |
| POST | `/api/portal/admin/set-password/{student_id}` | Admin: set or generate a student's portal password |

## Notifications (admin)

| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications/` | Notification log |
| GET | `/api/notifications/config` | Whether email / SMS are configured |
| POST | `/api/notifications/low-attendance` | Notify students below the attendance threshold |
| POST | `/api/notifications/absence` | Notify absentees of a session |
| POST | `/api/notifications/custom` | Send a custom message |

---

## Error Responses

All endpoints return standard error responses:

```json
{
  "detail": "Error message here"
}
```

| Status Code | Meaning |
|---|---|
| 400 | Bad request (validation error) |
| 401 | Unauthorized (missing or invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 409 | Conflict (e.g., duplicate student ID) |
| 422 | Unprocessable entity (invalid request body) |
| 500 | Internal server error |

---

## Quick Test with curl

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -F "username=admin" -F "password=$ADMIN_PASSWORD" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# List students
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/students/

# Get today's stats
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/attendance/stats

# Get today's attendance
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/attendance/today
```
