import { useState, useEffect, useCallback } from 'react';
import { Bell, Mail, MessageSquare, AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import client from '../../api/client';

const statusCls = {
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-200 text-slate-600',
};

const Notifications = () => {
  const [config, setConfig] = useState(null);
  const [log, setLog] = useState([]);
  const [threshold, setThreshold] = useState('');
  const [absenceDate, setAbsenceDate] = useState('');
  const [preview, setPreview] = useState(null); // { kind, data }
  const [busy, setBusy] = useState(false);

  const loadLog = useCallback(async () => {
    try {
      setLog((await client.get('/notifications/', { params: { limit: 100 } })).data);
    } catch {
      toast.error('Failed to load notification log');
    }
  }, []);

  useEffect(() => {
    client.get('/notifications/config').then((r) => setConfig(r.data)).catch(() => {});
    loadLog();
  }, [loadLog]);

  const request = (kind) => ({
    url: kind === 'low' ? '/notifications/low-attendance' : '/notifications/absence',
    body:
      kind === 'low'
        ? { threshold: threshold ? Number(threshold) : null }
        : { target_date: absenceDate || null },
  });

  // Step 1: show who would be alerted. Step 2: confirm to send.
  const doPreview = async (kind) => {
    setBusy(true);
    try {
      const { url, body } = request(kind);
      const res = await client.post(url, { ...body, dry_run: true });
      setPreview({ kind, data: res.data });
    } catch (err) {
      setPreview(null);
      toast.error(err.response?.data?.detail || 'Could not build the list');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const { url, body } = request(preview.kind);
      await client.post(url, { ...body, dry_run: false });
      toast.success(`Sending alerts to ${preview.data.count} student(s)...`);
      setPreview(null);
      setTimeout(loadLog, 2500); // alerts are sent in the background
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not send alerts');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none';
  const notConfigured = config && !config.email_configured && !config.sms_configured;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Bell className="w-6 h-6 text-indigo-600" /> Notifications
        </h1>
        <p className="text-slate-500 text-sm mt-1">Email or SMS alerts to students about absence and low attendance.</p>
      </div>

      {config && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium ${config.email_configured ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
            <Mail className="w-4 h-4" /> Email {config.email_configured ? 'configured' : 'not configured'}
          </span>
          <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium ${config.sms_configured ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
            <MessageSquare className="w-4 h-4" /> SMS {config.sms_configured ? 'configured' : 'not configured'}
          </span>
        </div>
      )}
      {notConfigured && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Nothing is set up to send messages yet, so alerts will be logged as &quot;skipped&quot;. Add <code>SMTP_HOST</code>,{' '}
            <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> (email) and/or <code>TWILIO_ACCOUNT_SID</code>,{' '}
            <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_FROM</code> (SMS) to <code>backend/.env</code> and restart the backend.
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 space-y-3">
          <h2 className="font-semibold text-slate-800">Low attendance alert</h2>
          <p className="text-sm text-slate-500">Students whose attendance is below the limit.</p>
          <div className="flex gap-2">
            <input type="number" min="1" max="100" placeholder="Limit % (default from Settings)" className={`${inputCls} flex-1`} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <button disabled={busy} onClick={() => doPreview('low')} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-lg">Preview</button>
          </div>
        </div>
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 space-y-3">
          <h2 className="font-semibold text-slate-800">Absence alert</h2>
          <p className="text-sm text-slate-500">Students with no attendance record on a day.</p>
          <div className="flex gap-2">
            <input type="date" className={`${inputCls} flex-1`} value={absenceDate} onChange={(e) => setAbsenceDate(e.target.value)} />
            <button disabled={busy} onClick={() => doPreview('absence')} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-lg">Preview</button>
          </div>
        </div>
      </div>

      {preview && (
        <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-200 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-slate-800">
              {preview.data.count} student(s) will be alerted
              {preview.kind === 'low' ? ` (below ${preview.data.threshold}%)` : ` (absent on ${preview.data.date})`}
            </h3>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button disabled={busy || preview.data.count === 0} onClick={send} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold">
                Send now
              </button>
            </div>
          </div>
          {preview.data.count === 0 ? (
            <p className="text-sm text-slate-400">Nobody matches.</p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {preview.data.students.map((s) => (
                <li key={s.student_id} className="py-1.5 flex justify-between">
                  <span>{s.name} <span className="text-slate-400">({s.student_id})</span></span>
                  <span className="text-slate-500">
                    {s.percentage != null && `${s.percentage}% · `}
                    {s.channels.length ? s.channels.join(' + ') : <span className="text-red-500">no email or phone</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Message log</h2>
          <button onClick={loadLog} className="text-slate-500 hover:text-slate-800"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-2">When</th><th className="px-4 py-2">Student</th><th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Channel</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {log.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-400">No messages yet.</td></tr>}
            {log.map((n) => (
              <tr key={n.id}>
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{n.created_at ? format(new Date(n.created_at), 'dd MMM, hh:mm a') : ''}</td>
                <td className="px-4 py-2 text-slate-800">{n.student || '-'}</td>
                <td className="px-4 py-2 text-slate-600">{n.kind}</td>
                <td className="px-4 py-2 text-slate-600">{n.channel}</td>
                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusCls[n.status]}`}>{n.status}</span></td>
                <td className="px-4 py-2 text-xs text-slate-500 max-w-xs truncate" title={n.error || ''}>{n.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Notifications;
