import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import toast from 'react-hot-toast';
import portalClient from '../../api/portalClient';

const PortalLogin = () => {
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await portalClient.post('/login', { student_id: studentId, password });
      localStorage.setItem('student_token', res.data.access_token);
      localStorage.setItem('student', JSON.stringify(res.data.student));
      window.location.href = '/portal';
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not sign in');
    } finally {
      setLoading(false);
    }
  };

  const cls =
    'w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-800 to-teal-600 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-4">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 text-center">Student Portal</h1>
          <p className="text-slate-500 text-sm mt-1 text-center">See your own attendance</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Student ID</label>
            <input className={cls} value={studentId} onChange={(e) => setStudentId(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" className={cls} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-md"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <p className="text-xs text-slate-400 text-center">
            No password? Ask your administrator to give you portal access.
          </p>
        </form>
        <div className="mt-6 text-center">
          <Link to="/login" className="text-xs text-slate-400 hover:text-slate-600">Administrator login</Link>
        </div>
      </div>
    </div>
  );
};

export default PortalLogin;
