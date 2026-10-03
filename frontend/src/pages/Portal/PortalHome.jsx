import { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { GraduationCap, LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, format, isSameMonth, parseISO,
} from 'date-fns';
import toast from 'react-hot-toast';
import portalClient from '../../api/portalClient';

const dayCls = {
  present: 'bg-green-500 text-white',
  late: 'bg-yellow-400 text-slate-900',
  absent: 'bg-red-500 text-white',
};

const PortalHome = () => {
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(new Date());
  const loggedIn = !!localStorage.getItem('student_token');

  useEffect(() => {
    if (!loggedIn) return;
    portalClient
      .get('/attendance')
      .then((res) => setData(res.data))
      .catch(() => toast.error('Could not load your attendance'));
  }, [loggedIn]);

  const byDate = useMemo(() => Object.fromEntries((data?.days || []).map((d) => [d.date, d.status])), [data]);

  if (!loggedIn) return <Navigate to="/portal/login" replace />;

  const logout = () => {
    localStorage.removeItem('student_token');
    localStorage.removeItem('student');
    window.location.href = '/portal/login';
  };

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const lead = getDay(startOfMonth(month)); // empty cells before the 1st
  const pct = data?.percentage;
  const pctColor = pct == null ? 'text-slate-400' : pct >= 75 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-emerald-700 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap className="w-7 h-7" />
            <div>
              <div className="font-bold leading-tight">{data?.student?.name || 'Student Portal'}</div>
              {data && (
                <div className="text-emerald-100 text-xs">
                  {data.student.student_id} · {data.student.department} · Year {data.student.year} Sec {data.student.section}
                </div>
              )}
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-2 text-sm hover:text-emerald-100">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {!data ? (
          <p className="text-center text-slate-500 py-10">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl p-5 shadow-sm col-span-2 md:col-span-1">
                <div className="text-xs font-bold uppercase text-slate-500">Attendance</div>
                <div className={`text-4xl font-black mt-1 ${pctColor}`}>{pct == null ? '—' : `${pct}%`}</div>
                {pct != null && pct < 75 && <div className="text-xs text-red-600 mt-1">Below the 75% requirement</div>}
              </div>
              {[
                ['Present', data.present, 'text-green-600'],
                ['Late', data.late, 'text-yellow-600'],
                ['Absent', data.absent, 'text-red-600'],
              ].map(([label, value, color]) => (
                <div key={label} className="bg-white rounded-xl p-5 shadow-sm">
                  <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
                  <div className={`text-3xl font-black mt-1 ${color}`}>{value}</div>
                  <div className="text-xs text-slate-400">of {data.total_days} days</div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setMonth(subMonths(month, 1))} className="p-2 rounded-lg hover:bg-slate-100">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="font-bold text-slate-800">{format(month, 'MMMM yyyy')}</h2>
                <button onClick={() => setMonth(addMonths(month, 1))} className="p-2 rounded-lg hover:bg-slate-100">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="font-semibold text-slate-400 pb-1">{d}</div>
                ))}
                {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
                {days.map((d) => {
                  const key = format(d, 'yyyy-MM-dd');
                  const st = byDate[key];
                  return (
                    <div
                      key={key}
                      title={st || 'No class'}
                      className={`aspect-square flex items-center justify-center rounded-lg text-sm font-semibold ${
                        st ? dayCls[st] || 'bg-slate-300' : 'bg-slate-50 text-slate-400'
                      } ${isSameMonth(d, new Date()) && format(d, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'ring-2 ring-indigo-500' : ''}`}
                    >
                      {format(d, 'd')}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 justify-center mt-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-green-500" /> Present</span>
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-yellow-400" /> Late</span>
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-red-500" /> Absent</span>
                <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-slate-200" /> No class</span>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <h2 className="font-bold text-slate-800 px-5 pt-5 pb-3">Recent records</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {data.records.length === 0 && (
                    <tr><td className="px-5 py-6 text-center text-slate-400">No attendance recorded yet.</td></tr>
                  )}
                  {data.records.slice(0, 15).map((r, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2.5 text-slate-700">{format(parseISO(r.date), 'EEE, dd MMM yyyy')}</td>
                      <td className="px-5 py-2.5 text-slate-500">{String(r.time_in).slice(0, 8)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          r.status === 'present' ? 'bg-green-100 text-green-700'
                            : r.status === 'late' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default PortalHome;
