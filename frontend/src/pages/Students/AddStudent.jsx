import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Camera, Hand, Fingerprint, CheckCircle, AlertCircle } from 'lucide-react';
import client from '../../api/client';
import { useFingerprintSupport, enrollFingerprint } from '../../utils/webauthn';
import MultiShotCapture from '../../components/MultiShotCapture';

const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];
// Steps: 1=Details, 2=Face, 3=Right Palm, 4=Left Palm, 5=Fingerprint, 6=Success
const TOTAL_STEPS = 6;

const AddStudent = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [studentId, setStudentId] = useState(null);
  const [loading, setLoading] = useState(false);
  const hasTouchId = useFingerprintSupport(); // null=checking, true/false
  const [formData, setFormData] = useState({
    student_id: '', name: '', department: 'CSE', year: '1', section: 'A', email: '', phone: '',
  });


  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  // ─── Step 1: Save Details ─────────────────────────────────────────────
  const handleSaveDetails = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await client.post('/students/', {
        student_id: formData.student_id.trim(),
        name:       formData.name.trim(),
        department: formData.department,
        year:       parseInt(formData.year, 10),
        section:    formData.section,
        email:      formData.email.trim() || null,
        phone:      formData.phone.trim() || null,
      });
      setStudentId(res.data.id);
      toast.success('Details saved! Now enrolling biometrics.');
      setStep(2);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Failed to save student';
      toast.error(typeof msg === 'string' ? msg : 'Validation error — check all fields');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2: Enroll Face ─────────────────────────────────────────────
  const [captureKey, setCaptureKey] = useState(0); // remount capture after a failed upload

  const handleCaptureFace = async (images) => {
    if (!images?.length) return;
    setLoading(true);
    try {
      await client.post(`/enrollment/face/${studentId}`, { images });
      toast.success('✅ Face enrolled!');
      setStep(3);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to enroll face. Try again.');
      setCaptureKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 3 & 4: Enroll Palm ─────────────────────────────────────────
  const handleCapturePalm = async (images, side) => {
    if (!images?.length) return;
    setLoading(true);
    try {
      await client.post(`/enrollment/palm/${studentId}`, { images, hand_side: side });
      toast.success(`✅ ${side === 'right' ? 'Right' : 'Left'} palm enrolled!`);
      setStep(side === 'right' ? 4 : 5);
    } catch (err) {
      toast.error(err.response?.data?.detail || `Failed to enroll ${side} palm. Show your ${side} palm clearly.`);
      setCaptureKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 5: Enroll Fingerprint (Touch ID) ───────────────────────────
  const handleEnrollFingerprint = async () => {
    setLoading(true);
    try {
      await enrollFingerprint(studentId, formData.name);
      toast.success('✅ Fingerprint enrolled via Touch ID!');
      setStep(6);
    } catch (err) {
      console.error(err);
      if (err.name === 'NotAllowedError') {
        toast.error('Fingerprint scan was cancelled or denied.');
      } else {
        toast.error(err.response?.data?.detail || err.message || 'Fingerprint enrollment failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Stepper UI ──────────────────────────────────────────────────────
  const stepLabels = ['Details', 'Face', 'Right Palm', 'Left Palm', 'Fingerprint', 'Done'];
  
  const StepBadge = ({ n, label }) => (
    <div className="flex flex-col items-center">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
        step > n ? 'bg-green-500 text-white' :
        step === n ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' :
        'bg-slate-200 text-slate-500'
      }`}>
        {step > n ? '✓' : n}
      </div>
      <span className={`text-[10px] mt-1 font-medium ${step === n ? 'text-indigo-600' : 'text-slate-400'}`}>{label}</span>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">

        {/* Stepper */}
        {step < 6 && (
          <div className="flex justify-center items-center gap-2 mb-8">
            {stepLabels.slice(0, 5).map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <StepBadge n={i + 1} label={label} />
                {i < 4 && <div className={`w-8 h-0.5 mb-3 ${step > i + 1 ? 'bg-green-500' : 'bg-slate-200'}`} />}
              </div>
            ))}
          </div>
        )}

        {/* Step 1 — Student Details */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-bold text-slate-800 mb-6 text-center">New Student Registration</h1>
            <form onSubmit={handleSaveDetails} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Student ID <span className="text-red-500">*</span></label>
                  <input name="student_id" required value={formData.student_id} onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="e.g. CS2024001" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                  <input name="name" required value={formData.name} onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="e.g. Harish Kumar" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                  <select name="department" value={formData.department} onChange={handleChange} className="w-full px-4 py-2 border rounded-lg outline-none">
                    {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
                  <select name="year" value={formData.year} onChange={handleChange} className="w-full px-4 py-2 border rounded-lg outline-none">
                    {['1','2','3','4'].map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
                  <select name="section" value={formData.section} onChange={handleChange} className="w-full px-4 py-2 border rounded-lg outline-none">
                    {['A','B','C','D'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email <span className="text-slate-400 text-xs">(optional)</span></label>
                  <input name="email" type="email" value={formData.email} onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg outline-none" placeholder="student@college.edu" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone <span className="text-slate-400 text-xs">(optional)</span></label>
                  <input name="phone" type="tel" value={formData.phone} onChange={handleChange}
                    className="w-full px-4 py-2 border rounded-lg outline-none" placeholder="+91 9876543210" />
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition shadow">
                {loading ? 'Saving...' : 'Save & Continue to Biometrics →'}
              </button>
            </form>
          </div>
        )}

        {/* Step 2 — Face */}
        {step === 2 && (
          <div className="flex flex-col items-center gap-5">
            <Camera className="w-10 h-10 text-indigo-500" />
            <div className="text-center">
              <h2 className="text-2xl font-bold">Enroll Face</h2>
              <p className="text-slate-500 mt-1">Three quick shots are taken (straight, slightly left, slightly right) so recognition works in different poses.</p>
            </div>
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-500">Uploading face data...</p>
              </div>
            ) : (
              <MultiShotCapture key={`face-${captureKey}`} mode="face" shots={3} onComplete={handleCaptureFace} />
            )}
            <button onClick={() => setStep(3)} className="text-sm text-slate-400 underline">Skip Face Enrollment</button>
          </div>
        )}

        {/* Step 3 — Right Palm */}
        {step === 3 && (
          <div className="flex flex-col items-center gap-5">
            <Hand className="w-10 h-10 text-indigo-500" />
            <div className="text-center">
              <h2 className="text-2xl font-bold">Enroll Right Palm</h2>
              <p className="text-slate-500 mt-1">Show your <strong>right hand</strong> palm, flat and facing the camera. Wait for the blue box.</p>
            </div>
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-500">Enrolling right palm...</p>
              </div>
            ) : (
              <MultiShotCapture key={`rp-${captureKey}`} mode="palm" shots={3} onComplete={(imgs) => handleCapturePalm(imgs, 'right')} />
            )}
            <button onClick={() => setStep(4)} className="text-sm text-slate-400 underline">Skip Right Palm</button>
          </div>
        )}

        {/* Step 4 — Left Palm */}
        {step === 4 && (
          <div className="flex flex-col items-center gap-5">
            <Hand className="w-10 h-10 text-blue-500" />
            <div className="text-center">
              <h2 className="text-2xl font-bold">Enroll Left Palm</h2>
              <p className="text-slate-500 mt-1">Now show your <strong>left hand</strong> palm, flat and facing the camera. Wait for the blue box.</p>
            </div>
            {loading ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-500">Enrolling left palm...</p>
              </div>
            ) : (
              <MultiShotCapture key={`lp-${captureKey}`} mode="palm" shots={3} onComplete={(imgs) => handleCapturePalm(imgs, 'left')} />
            )}
            <button onClick={() => setStep(5)} className="text-sm text-slate-400 underline">Skip Left Palm</button>
          </div>
        )}

        {/* Step 5 — Fingerprint */}
        {step === 5 && (
          <div className="flex flex-col items-center gap-6 text-center py-8">
            <Fingerprint className={`w-16 h-16 ${hasTouchId ? 'text-indigo-500' : 'text-slate-300'}`} />
            <div>
              <h2 className="text-2xl font-bold">Enroll Fingerprint</h2>
              {hasTouchId === null && <p className="text-slate-500 mt-2">Checking system fingerprint reader...</p>}
              {hasTouchId === false && (
                <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-5 py-3 rounded-xl text-sm font-medium">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  No fingerprint reader found on this system. Fingerprint enrollment is not available on this device.
                </div>
              )}
              {hasTouchId === true && (
                <p className="text-slate-500 mt-2">
                  Click the button below to scan the student's fingerprint with this device's fingerprint sensor.
                  When prompted, <strong>use your fingerprint</strong> (not password or passkey).
                </p>
              )}
            </div>

            {hasTouchId === true && (
              <button onClick={handleEnrollFingerprint} disabled={loading}
                className="flex items-center gap-3 px-10 py-4 bg-indigo-600 text-white text-lg font-bold rounded-2xl hover:bg-indigo-700 disabled:opacity-50 shadow-xl transition">
                <Fingerprint className="w-6 h-6" />
                {loading ? 'Scanning...' : 'Scan Fingerprint'}
              </button>
            )}

            <button onClick={() => setStep(6)} className="text-sm text-slate-400 underline">
              {hasTouchId ? 'Skip Fingerprint' : 'Continue Without Fingerprint'}
            </button>
          </div>
        )}

        {/* Step 6 — Success */}
        {step === 6 && (
          <div className="text-center py-12">
            <CheckCircle className="w-24 h-24 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Registration Complete!</h1>
            <p className="text-slate-500 mb-8">The student's profile and biometrics have been successfully enrolled.</p>
            <div className="flex gap-4 justify-center">
              <button onClick={() => navigate('/students/add')}
                className="px-6 py-2.5 bg-indigo-100 text-indigo-700 font-bold rounded-xl hover:bg-indigo-200 transition">
                Add Another Student
              </button>
              <button onClick={() => navigate('/students')}
                className="px-6 py-2.5 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition">
                Go to Student List
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AddStudent;
