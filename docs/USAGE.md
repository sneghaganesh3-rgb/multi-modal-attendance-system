# Usage Guide — Multi-Modal Attendance System

This guide explains how to use every feature of the system after it is installed and running.

---

## Logging In

1. Open **http://localhost:5173** in your browser.
2. Enter username `admin` and the admin password (`ADMIN_PASSWORD` from `backend/.env`; if unset, see the backend console output on first start).
3. Click **Login**.
4. You will be redirected to the **Dashboard**.

---

## Dashboard

The Dashboard shows at a glance:

| Card | What it shows |
|---|---|
| Total Students | Number of registered students |
| Present Today | How many marked attendance today |
| Absent Today | Total students minus present |
| Late Today | How many arrived after the cutoff time |
| Attendance Rate | Percentage present today |

Below the cards:
- **Line Chart** — Attendance trend for the last 7 days.
- **Pie Chart** — Present / Absent / Late breakdown.
- **Recent Attendance** — Last 10 attendance records with student name, time, and method.
- **Quick Actions** — Jump to Mark Attendance or Add Student.

---

## Student Management

### Adding a Student

1. Click **Students** in the sidebar.
2. Click the **+ Add Student** button.
3. Fill in:
   - **Student ID** — unique identifier (e.g., `CSE2024001`)
   - **Full Name**
   - **Department** — CSE / IT / ECE / EEE / MECH / CIVIL
   - **Year** — 1, 2, 3, or 4
   - **Section** — A, B, C, or D
   - **Email** (optional)
   - **Phone** (optional)
4. Click **Save Student**.

The student is now in the system but has **no biometrics enrolled yet**.

### Editing a Student

1. In the student list, click the **Edit** (pencil) icon for a student.
2. Update any fields.
3. Click **Update Student**.

### Deleting a Student

1. Click the **Delete** (trash) icon.
2. Confirm in the popup.
3. The student is soft-deleted (deactivated, not removed from DB).

### Searching Students

Use the search bar at the top of the student list to search by:
- Name
- Student ID
- Department (dropdown filter)

---

## Biometric Enrollment

Every student must be enrolled in at least **one biometric modality** before they can mark attendance. Two modalities are recommended for multi-modal fusion.

### Face Enrollment

1. Go to **Students** → find the student → click **Enroll Biometrics** → **Face**.
   OR from the student's detail page, click **Enroll Face**.
2. Allow camera access when prompted.
3. The webcam feed will appear. Ask the student to:
   - Look directly at the camera.
   - Keep their face centered in the frame.
   - Ensure good lighting (avoid backlighting).
4. Click **Capture**.
5. A preview of the captured frame will appear.
6. If the face is clear, click **Submit** to enroll.
7. The system will extract the face embedding and save it.
8. A green ✅ badge will now appear next to the student's face status.

**Tips for good face enrollment:**
- Capture in the same lighting conditions as attendance will be taken.
- The student should not wear sunglasses.
- Re-enroll if the student changes appearance significantly (new glasses, beard, etc.).

### Palm Enrollment

1. Navigate to **Enrollment → Palm** for the student.
2. Ask the student to:
   - Hold their palm **flat** facing the camera.
   - Keep their hand **centered** in the frame.
   - Spread fingers slightly for better landmark detection.
3. Click **Capture** → **Submit**.
4. MediaPipe extracts 21 hand landmarks (63 float features).
5. A green ✅ badge will appear for palm status.

**Tips:**
- Ensure the full hand is visible (not cut off at the edges).
- Use consistent lighting.

### Fingerprint Enrollment

> Uses the fingerprint sensor built into the device running the browser (Windows Hello, Touch ID, Android) through WebAuthn. No external scanner is needed. If the system has no fingerprint reader, the page shows **"No fingerprint reader found on this system"** and fingerprint is skipped. Requires `localhost` or HTTPS.

1. Navigate to **Enrollment → Fingerprint** for the student (or use the fingerprint step in Add Student).
2. Click **Start Scan** and place your finger on the sensor when the system prompts.
3. The server stores the credential id and public key (never the fingerprint itself).
4. A ✅ badge appears for fingerprint status.

---

## Marking Attendance

Go to **Mark Attendance** in the sidebar. You will see three tabs:

---

### Mode 1: Face Only

Best for: Quick attendance where students stand/sit in front of a camera.

1. Click the **Face Only** tab.
2. The webcam activates automatically.
3. The student looks at the camera.
4. Click **Verify Face**.
5. The system:
   - Detects and encodes the face.
   - Compares it with all enrolled face templates.
   - Returns the best match with a similarity score.
6. Result card shows:
   - Student Name & ID
   - Face Similarity Score (0.0 – 1.0)
   - **VERIFIED** (green) or **REJECTED** (red) badge
7. If **VERIFIED**: attendance is automatically recorded.

---

### Mode 2: Palm Only

1. Click the **Palm Only** tab.
2. Student holds their palm to the camera.
3. Click **Verify Palm**.
4. Same result flow as Face mode.

---

### Mode 3: Multi-Modal (Recommended)

Combines two or three modalities for highest accuracy.

1. Click the **Multi-Modal** tab.
2. Three sections appear: **Face**, **Palm**, **Fingerprint**.
3. Capture at least **two** modalities:
   - Click **Capture Face** → webcam captures face.
   - Click **Capture Palm** → webcam captures palm.
   - Click **Scan & Verify Fingerprint** → scan on the device sensor (hidden if no reader is present).
4. Click **Verify All**.
5. The Fusion Engine computes:
   ```
   Fusion Score = 0.45 × Face + 0.35 × Fingerprint + 0.20 × Palm
   ```
6. Result card shows:
   - Individual scores for each modality used.
   - Fusion Score.
   - Final decision: **VERIFIED** / **NEEDS REVIEW** / **REJECTED**.
7. If **VERIFIED**: click **Mark Attendance** to record.

---

### Attendance Status Logic

| Condition | Status |
|---|---|
| Arrives before 9:15 AM | **Present** ✅ |
| Arrives after 9:15 AM | **Late** 🕐 |
| Not marked by end of day | **Absent** ❌ |

The late cutoff time is configurable in **Settings**.

### Duplicate Prevention

If a student tries to mark attendance twice on the same day, the system will show an "Already marked today" message and reject the second attempt.

---

## Attendance Records

Go to **Attendance Records** to view all recorded entries.

### Filtering

- **Date range** — From date / To date
- **Department** — Filter by department
- **Status** — Present / Late / Absent
- **Search** — Student name or ID

### Table Columns

| Column | Description |
|---|---|
| Date | Attendance date |
| Time | Time recorded |
| Student ID | Unique student identifier |
| Name | Student full name |
| Department | Student department |
| Method | face / palm / fingerprint / multimodal |
| Face Score | Score from face verification (if used) |
| Palm Score | Score from palm verification (if used) |
| FP Score | Fingerprint score (if used) |
| Fusion Score | Combined weighted score |
| Status | Present / Late / Absent |

---

## Reports

Go to **Reports** for detailed analysis.

### Daily Report

1. Click **Daily** tab.
2. Select a date.
3. View: Present count, Absent count, Late count, Attendance rate %.
4. See the full table for that day.
5. Export with **Download CSV** or **Download PDF**.

### Weekly Report

1. Click **Weekly** tab.
2. Select the week start date.
3. See a **bar chart** showing attendance per day of the week.
4. View the table of all records for that week.

### Monthly Report

1. Click **Monthly** tab.
2. Select month and year.
3. See a **line chart** of attendance trend across the month.
4. See department-wise breakdown.

### Student-wise Report

1. Click **Student-wise** tab.
2. Search for a student by name or ID.
3. See their full attendance history.
4. See their personal attendance rate %.

### Exporting

- **CSV** — Opens a `.csv` file with all filtered records. Open in Excel or Google Sheets.
- **PDF** — Generates a formatted PDF report with title, date, and table. Ready to print or share.

---

## Settings

Go to **Settings** to configure system behavior.

### Thresholds

| Setting | Default | Meaning |
|---|---|---|
| Face Threshold | 0.50 | Minimum face score to count as a match |
| Palm Threshold | 0.70 | Minimum palm score to count as a match |
| Fingerprint Threshold | 0.75 | Minimum fingerprint score for a match |
| Fusion Threshold | 0.60 | Minimum fusion score to verify attendance |

Higher threshold = stricter matching (fewer false positives, more false negatives).

### Fusion Weights

| Setting | Default | Meaning |
|---|---|---|
| Face Weight | 0.45 | How much face contributes to fusion |
| Fingerprint Weight | 0.35 | How much fingerprint contributes |
| Palm Weight | 0.20 | How much palm contributes |

> The three weights must add up to **1.0**. The UI will warn you if they don't.

### Late Cutoff Time

- **Late Cutoff Hour** — Default: 9 (9 AM)
- **Late Cutoff Minute** — Default: 15 (15 minutes past)

Students arriving after 9:15 AM are marked **Late**.

Click **Save Settings** after making changes.

---

## System Flow Diagram

```
Admin Login
    │
    ▼
Add Student (student_id, name, dept, year, section)
    │
    ▼
Enroll Biometrics
    ├── Face → webcam capture → face embedding stored
    ├── Palm → webcam capture → landmark features stored
    └── Fingerprint → device sensor (WebAuthn) → credential stored
    │
    ▼
Mark Attendance
    ├── Face Mode → match face → record
    ├── Palm Mode → match palm → record
    └── Multi-Modal → match all → fuse scores → record
    │
    ▼
View Records / Reports → Export CSV/PDF
```

---

## Common Questions

**Q: Can a student be enrolled in only one modality?**
Yes. They can use single-modality attendance (Face Only or Palm Only). Multi-modal fusion requires at least two.

**Q: What happens if the webcam can't detect a face?**
The system returns an error: "No face detected. Please ensure your face is visible and well-lit." The student should retry.

**Q: Can attendance be edited after it's recorded?**
Currently, attendance records are read-only from the UI. Database edits can be done directly in the SQLite file (`backend/attendance.db`) if needed.

**Q: Which fingerprint scanner is supported?**
The one built into the device (Windows Hello, Touch ID, Android). The server verifies a signed WebAuthn response, so no SDK or USB scanner is needed. Set `CORS_ORIGINS` in `backend/.env` to the URL you open the app from; it is also the allowed WebAuthn origin.

**Q: Can I export attendance for a specific class?**
Yes. Use the Department filter in Reports, then export.


---

## Accuracy & Anti-Spoofing

- **Enrollment takes 3 shots** (face: straight / slightly left / slightly right; palm: three steady shots, averaged). Each face shot becomes its own template; matching uses the best one.
- **Face liveness is verified by the server.** In *Mark Attendance*, press *Start liveness check*, then follow the instruction (blink once, turn your head toward the shown side). Photos, screens showing a still image and face swaps are rejected.
- **Adaptive learning:** when a face is verified *and* confirmed by palm or fingerprint, the system may store that sample (max one per student per day, 6 templates per student) to keep up with hairstyle, glasses and aging.
- **Safer decisions:** a clearly wrong modality vetoes the match; a lone face needs a higher score; two near-identical matches are reported as *ambiguous* instead of guessing.
- Tune the behaviour with the keys listed under *Accuracy settings* in `docs/API.md`.
