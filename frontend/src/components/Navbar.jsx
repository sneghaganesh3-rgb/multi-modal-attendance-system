import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { LogOut, User } from 'lucide-react';

const Navbar = () => {
  const [time, setTime] = useState(new Date());
  const navigate = useNavigate();
  const adminStr = localStorage.getItem('admin');
  const admin = adminStr ? JSON.parse(adminStr) : { name: 'Admin' };

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('admin');
    navigate('/login');
  };

  return (
    <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 shrink-0">
      <div className="text-slate-600 font-medium">
        {format(time, 'EEEE, MMMM d, yyyy | hh:mm:ss a')}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-slate-700">
          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
            <User className="w-5 h-5" />
          </div>
          <span className="font-medium">{admin.name}</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-slate-500 hover:text-red-500 transition-colors p-2"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

export default Navbar;
