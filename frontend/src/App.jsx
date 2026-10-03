import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import StudentList from './pages/Students/StudentList';
import AddStudent from './pages/Students/AddStudent';
import EditStudent from './pages/Students/EditStudent';
import StudentDetail from './pages/Students/StudentDetail';
import FaceEnroll from './pages/Enrollment/FaceEnroll';
import PalmEnroll from './pages/Enrollment/PalmEnroll';
import FingerprintEnroll from './pages/Enrollment/FingerprintEnroll';
import MarkAttendance from './pages/Attendance/MarkAttendance';
import AttendanceList from './pages/Attendance/AttendanceList';
import Reports from './pages/Reports/Reports';
import Settings from './pages/Settings/Settings';
import Sessions from './pages/Sessions/Sessions';
import Notifications from './pages/Notifications/Notifications';
import PortalLogin from './pages/Portal/PortalLogin';
import PortalHome from './pages/Portal/PortalHome';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal" element={<PortalHome />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/students" element={<StudentList />} />
        <Route path="/students/add" element={<AddStudent />} />
        <Route path="/students/edit/:id" element={<EditStudent />} />
        <Route path="/students/:id" element={<StudentDetail />} />
        <Route path="/enrollment/:id/face" element={<FaceEnroll />} />
        <Route path="/enrollment/:id/palm" element={<PalmEnroll />} />
        <Route path="/enrollment/:id/fingerprint" element={<FingerprintEnroll />} />
        <Route path="/attendance" element={<MarkAttendance />} />
        <Route path="/attendance/records" element={<AttendanceList />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
