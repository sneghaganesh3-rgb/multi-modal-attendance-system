import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Plus, XCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import client from '../../api/client';

const badge = {
  open: 'bg-green-100 text-green-700',
  upcoming: 'bg-blue-100 text-blue-700',
  closed: 'bg-slate-200 text-slate-600',
};

const inputCls =
  'w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm';

const emptyForm = {
  title: '',
  department: '',
  year: '',
  section: '',
  start_time: '',
  duration_minutes: 60,
  grace_minutes: 10,
};

const Sessions = () => {
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await client.get('/sessions/');
      setSessions(res.data);
    } catch {
      toast.error('Failed to load sessions');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // statuses change with time
    return () => clearInterval(t);
  }, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await client.post('/sessions/', {
        title: form.title,
        department: form.department || null,
        year: form.year ? Number(form.year) : null,
        section: form.section || null,
        start_time: form.start_time || null, // empty = start now
        duration_minutes: Number(form.duration_minutes),
        grace_minutes: Number(form.grace_minutes),
      });
      toast.success('Session created');
      setForm(emptyForm);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not create session');
    } finally {
      setSaving(false);
    }
  };

  const close = async (s) => {
    if (!window.confirm(`Close "${s.title}" now? Nobody can mark attendance in it afterwards.`)) return;
    try {
      const res = await client.post(`/sessions/${s.id}/close`);
      toast.success(res.data.absence_alerts_queued ? 'Session closed. Absence alerts are being sent.' : 'Session closed');
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not close session');
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete "${s.title}"?`)) return;
    try {
      await client.delete(`/sessions/${s.id}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not delete session');
    }
  };

  const openDetail = async (s) => {
    try {
      const res = await client.get(`/sessions/${s.id}`);
      setDetail(res.data);
    } catch {
      toast.error('Failed to load session');
    }
  };

  const fmt = (iso) => format(new Date(iso), 'dd MMM, hh:mm a');

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-indigo-600" /> Attendance Sessions
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Students can mark attendance only while a session is open, and only if they belong to its class group.
          </p>
        </div>
      </div>

      <form onSubmit={create} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Plus className="w-4 h-4" /> New session
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input className={inputCls} value={form.title} onChange={set('title')} placeholder="e.g. Data Structures - Period 2" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Starts (blank = now)</label>
            <input type="datetime-local" className={inputCls} value={form.start_time} onChange={set('start_time')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Minutes</label>
              <input type="number" min="1" max="1440" className={inputCls} value={form.duration_minutes} onChange={set('duration_minutes')} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Late after (min)</label>
              <input type="number" min="0" className={inputCls} value={form.grace_minutes} onChange={set('grace_minutes')} required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Department (blank = all)</label>
            <input className={inputCls} value={form.department} onChange={set('department')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Year (blank = all)</label>
            <input type="number" min="1" className={inputCls} value={form.year} onChange={set('year')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Section (blank = all)</label>
            <input className={inputCls} value={form.section} onChange={set('section')} />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm"
            >
              {saving ? 'Creating...' : 'Create session'}
            </button>
          </div>
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Present / Late / Expected</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.length === 0 && (
              <tr>
                <td colSpan="6" className="px-4 py-8 text-center text-slate-400">No sessions yet.</td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{s.title}</td>
                <td className="px-4 py-3 text-slate-600">
                  {[s.department, s.year ? `Year ${s.year}` : null, s.section ? `Sec ${s.section}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'Everyone'}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {fmt(s.start_time)} - {format(new Date(s.end_time), 'hh:mm a')}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${badge[s.status]}`}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {s.present} / {s.late} / {s.expected}
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => openDetail(s)} className="text-indigo-600 hover:underline inline-flex items-center gap-1">
                    <Users className="w-4 h-4" /> View
                  </button>
                  {s.status !== 'closed' && (
                    <button onClick={() => close(s)} className="text-amber-600 hover:underline inline-flex items-center gap-1">
                      <XCircle className="w-4 h-4" /> Close
                    </button>
                  )}
                  <button onClick={() => remove(s)} className="text-red-500 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-slate-800">{detail.title}</h3>
                <p className="text-sm text-slate-500">
                  {fmt(detail.start_time)} · late after {detail.grace_minutes} min
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <h4 className="font-semibold text-slate-700 mb-2">Attended ({detail.attendance.length})</h4>
            <ul className="divide-y divide-slate-100 mb-5 text-sm">
              {detail.attendance.length === 0 && <li className="py-2 text-slate-400">Nobody yet.</li>}
              {detail.attendance.map((a) => (
                <li key={a.student_id} className="py-2 flex justify-between">
                  <span>{a.name} <span className="text-slate-400">({a.student_id})</span></span>
                  <span className={a.status === 'late' ? 'text-yellow-600 font-semibold' : 'text-green-600 font-semibold'}>
                    {a.status} · {String(a.time_in).slice(0, 8)}
                  </span>
                </li>
              ))}
            </ul>
            <h4 className="font-semibold text-slate-700 mb-2">Absent ({detail.absent.length})</h4>
            <ul className="divide-y divide-slate-100 text-sm">
              {detail.absent.length === 0 && <li className="py-2 text-slate-400">Nobody is absent.</li>}
              {detail.absent.map((a) => (
                <li key={a.student_id} className="py-2">
                  {a.name} <span className="text-slate-400">({a.student_id})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sessions;
