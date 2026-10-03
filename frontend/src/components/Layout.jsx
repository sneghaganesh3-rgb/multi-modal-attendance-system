import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Fingerprint, UserCheck, ClipboardList, BarChart3, Settings, CalendarClock, Bell } from 'lucide-react';
import Navbar from './Navbar';

const Layout = () => {
  const location = useLocation();

  const links = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/students', label: 'Students', icon: Users },
    { to: '/sessions', label: 'Sessions', icon: CalendarClock },
    { to: '/attendance', label: 'Mark Attendance', icon: UserCheck },
    { to: '/attendance/records', label: 'Attendance Records', icon: ClipboardList },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-slate-100">
      <div className="w-64 bg-indigo-950 text-white flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-indigo-900">
          <Fingerprint className="w-8 h-8 text-indigo-400" />
          <span className="font-bold text-lg leading-tight">Multi-Modal<br/>Attendance</span>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {links.map((link) => {
            const Icon = link.icon;
            // Exact match for base routes to prevent overlap (e.g. /attendance vs /attendance/records)
            const isActive = link.to === '/attendance' 
              ? location.pathname === '/attendance'
              : location.pathname.startsWith(link.to);
              
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
