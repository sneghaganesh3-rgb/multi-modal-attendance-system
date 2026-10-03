@echo off
echo Starting Multi-Modal Attendance System...

echo Starting Backend Server (FastAPI on http://localhost:8000)...
start "Attendance Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn main:app --reload --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak >nul

echo Starting Frontend Server (Vite on http://localhost:5173)...
start "Attendance Frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --host"

echo.
echo ========================================================
echo System is launching!
echo Backend API Docs: http://localhost:8000/docs
echo Frontend Portal:  http://localhost:5173
echo Login:            admin / ADMIN_PASSWORD from backend/.env (or see backend console)
echo ========================================================
timeout /t 5
start http://localhost:5173
