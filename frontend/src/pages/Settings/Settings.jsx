import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Trash2 } from 'lucide-react';
import client from '../../api/client';

const Settings = () => {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  
  const [settings, setSettings] = useState({
    FACE_THRESHOLD: 0.50,
    PALM_THRESHOLD: 0.70,
    FUSION_THRESHOLD: 0.60,
    FACE_WEIGHT: 0.45,
    PALM_WEIGHT: 0.20,
    FINGERPRINT_WEIGHT: 0.35,
    SESSION_REQUIRED: 0,
    LOW_ATTENDANCE_THRESHOLD: 75,
    NOTIFY_ON_SESSION_CLOSE: 0
  });

  // Fetch settings from DB on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await client.get('/settings/');
        const dbSettings = {};
        res.data.forEach(item => {
          if (settings.hasOwnProperty(item.key)) {
            dbSettings[item.key] = parseFloat(item.value);
          }
        });
        setSettings(prev => ({ ...prev, ...dbSettings }));
      } catch (err) {
        toast.error('Failed to load settings');
      } finally {
        setFetching(false);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: parseFloat(value) }));
  };

  const handleSave = async () => {
    const sum = settings.FACE_WEIGHT + settings.PALM_WEIGHT + settings.FINGERPRINT_WEIGHT;
    if (Math.abs(sum - 1.0) > 0.001) {
      toast.error('Fusion Weights must sum to exactly 1.0');
      return;
    }
    
    setLoading(true);
    try {
      const payload = Object.entries(settings).map(([key, value]) => ({
        key,
        value: value.toString()
      }));
      
      await client.put('/settings/', payload);
      toast.success('Settings updated successfully in database');
    } catch (err) {
      toast.error('Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const handleWipeData = async () => {
    const confirm = window.confirm(
      "WARNING: This will completely delete ALL students, biometric templates, and attendance records from the database. This action cannot be undone.\n\nAre you absolutely sure?"
    );
    if (!confirm) return;

    const doubleConfirm = window.prompt("Type 'DELETE ALL' to confirm:");
    if (doubleConfirm !== "DELETE ALL") {
      toast.error("Wipe cancelled.");
      return;
    }

    setLoading(true);
    try {
      const res = await client.delete('/settings/wipe-data');
      toast.success(res.data.message || 'Database wiped successfully!');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to wipe data.');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <div className="p-8 text-center text-slate-500">Loading settings...</div>;

  const weightsSum = settings.FACE_WEIGHT + settings.PALM_WEIGHT + settings.FINGERPRINT_WEIGHT;

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <h1 className="text-2xl font-bold text-slate-800">System Settings</h1>

      {/* Danger Zone */}
      <div className="bg-red-50 p-6 rounded-xl shadow-sm border border-red-200 space-y-4">
        <div className="flex items-center gap-2 border-b border-red-200 pb-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h2 className="text-lg font-bold text-red-700">Danger Zone</h2>
        </div>
        <p className="text-sm text-red-600 font-medium">
          Permanently remove all students, biometric data, and attendance records from the database.
        </p>
        <button 
          onClick={handleWipeData}
          disabled={loading}
          className="flex items-center gap-2 bg-red-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 transition shadow-sm"
        >
          <Trash2 className="w-5 h-5" />
          {loading ? 'Processing...' : 'Wipe All Data'}
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <h2 className="text-lg font-semibold text-slate-800 border-b pb-2">Verification Thresholds</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Face Match Threshold ({settings.FACE_THRESHOLD})</label>
            <input type="range" min="0" max="1" step="0.01" value={settings.FACE_THRESHOLD} onChange={e => handleChange('FACE_THRESHOLD', e.target.value)} className="w-full accent-indigo-600" />
            <p className="text-xs text-slate-500 mt-1">Lower is stricter (FaceNet distance vs score).</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Palm Match Threshold ({settings.PALM_THRESHOLD})</label>
            <input type="range" min="0" max="1" step="0.01" value={settings.PALM_THRESHOLD} onChange={e => handleChange('PALM_THRESHOLD', e.target.value)} className="w-full accent-indigo-600" />
            <p className="text-xs text-slate-500 mt-1">Higher is stricter (Cosine similarity).</p>
          </div>
          <div className="col-span-1 md:col-span-2 pt-2 border-t border-slate-100">
            <label className="block text-sm font-medium text-slate-700 mb-2">Final Multi-Modal Fusion Threshold ({settings.FUSION_THRESHOLD})</label>
            <input type="range" min="0" max="1" step="0.01" value={settings.FUSION_THRESHOLD} onChange={e => handleChange('FUSION_THRESHOLD', e.target.value)} className="w-1/2 accent-indigo-600" />
            <p className="text-xs text-slate-500 mt-1">Minimum weighted average score required to mark attendance.</p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <h2 className="text-lg font-semibold text-slate-800 border-b pb-2">Fusion Weights (Must sum to 1.0)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Face Weight</label>
            <input type="number" step="0.05" min="0" max="1" value={settings.FACE_WEIGHT} onChange={e => handleChange('FACE_WEIGHT', e.target.value)} className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Palm Weight</label>
            <input type="number" step="0.05" min="0" max="1" value={settings.PALM_WEIGHT} onChange={e => handleChange('PALM_WEIGHT', e.target.value)} className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Fingerprint Weight</label>
            <input type="number" step="0.05" min="0" max="1" value={settings.FINGERPRINT_WEIGHT} onChange={e => handleChange('FINGERPRINT_WEIGHT', e.target.value)} className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        {Math.abs(weightsSum - 1.0) > 0.001 ? (
          <p className="text-red-500 text-sm font-medium">Warning: Weights must sum to 1.0 (Current sum: {weightsSum.toFixed(2)})</p>
        ) : (
          <p className="text-green-600 text-sm font-medium">Weights are valid (Sum = 1.0)</p>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-5">
        <h2 className="text-lg font-semibold text-slate-800 border-b pb-2">Sessions &amp; Alerts</h2>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={settings.SESSION_REQUIRED === 1} onChange={e => handleChange('SESSION_REQUIRED', e.target.checked ? 1 : 0)} className="mt-1 w-4 h-4 accent-indigo-600" />
          <span>
            <span className="block text-sm font-medium text-slate-700">Require an open session to mark attendance</span>
            <span className="block text-xs text-slate-500">When on, attendance is rejected unless a session is selected and open.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={settings.NOTIFY_ON_SESSION_CLOSE === 1} onChange={e => handleChange('NOTIFY_ON_SESSION_CLOSE', e.target.checked ? 1 : 0)} className="mt-1 w-4 h-4 accent-indigo-600" />
          <span>
            <span className="block text-sm font-medium text-slate-700">Send absence alerts when a session is closed</span>
            <span className="block text-xs text-slate-500">Email/SMS goes to students in the session&apos;s group who did not attend (see Notifications).</span>
          </span>
        </label>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Low attendance limit (%)</label>
          <input type="number" min="1" max="100" value={settings.LOW_ATTENDANCE_THRESHOLD} onChange={e => handleChange('LOW_ATTENDANCE_THRESHOLD', e.target.value)} className="w-32 px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      <button onClick={handleSave} disabled={loading || Math.abs(weightsSum - 1.0) > 0.001} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-indigo-700 transition shadow-sm disabled:opacity-50">
        {loading ? 'Saving...' : 'Save Settings to Database'}
      </button>
    </div>
  );
};

export default Settings;
