import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Fingerprint, AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFingerprintSupport, enrollFingerprint } from '../../utils/webauthn';

const FingerprintEnroll = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const hasTouchId = useFingerprintSupport(); // null=checking, true/false
  const [enrolled, setEnrolled] = useState(false);


  const startScan = async () => {
    setScanning(true);
    try {
      await enrollFingerprint(id);

      toast.success('Fingerprint enrolled successfully!');
      setEnrolled(true);
      setTimeout(() => navigate(`/students/${id}`), 1500);
    } catch (err) {
      console.error(err);
      if (err.name === 'NotAllowedError') {
        toast.error('Fingerprint scan was cancelled or denied. Please try again.');
      } else {
        toast.error(err.response?.data?.detail || err.message || 'Fingerprint enrollment failed. Please try again.');
      }
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center">
      <h1 className="text-2xl font-bold mb-1">Fingerprint Enrollment</h1>
      <p className="text-slate-400 text-sm mb-8">Student Record ID: {id}</p>

      <div className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl mb-8 transition-all ${
        enrolled ? 'border-green-400 bg-green-50' :
        scanning ? 'border-indigo-400 bg-indigo-50' :
        hasTouchId === false ? 'border-slate-200 bg-slate-50' :
        'border-slate-300 bg-slate-50'
      }`}>
        {enrolled ? (
          <CheckCircle className="w-16 h-16 text-green-500 mb-3" />
        ) : (
          <Fingerprint className={`w-16 h-16 mb-3 transition-all ${
            scanning ? 'text-indigo-500 animate-pulse' :
            hasTouchId === false ? 'text-slate-300' : 'text-slate-400'
          }`} />
        )}

        {/* Status text */}
        {hasTouchId === null && <p className="text-slate-500 font-medium">Checking system fingerprint reader...</p>}
        
        {hasTouchId === false && (
          <div className="flex flex-col items-center gap-2">
            <p className="font-bold text-slate-600">No Fingerprint Reader Found</p>
            <p className="text-slate-500 text-sm max-w-xs">
              No fingerprint reader was found on this system (Windows Hello / Touch ID). 
              Fingerprint enrollment is not available on this device.
            </p>
            <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-xl text-sm font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Fingerprint not available
            </div>
          </div>
        )}

        {hasTouchId === true && !scanning && !enrolled && (
          <p className="text-slate-600 font-medium">Click "Start Scan" and place your finger on the sensor when prompted.</p>
        )}

        {scanning && (
          <p className="text-indigo-600 font-bold">Waiting for fingerprint... Place your finger on the sensor.</p>
        )}

        {enrolled && (
          <p className="text-green-700 font-bold">Fingerprint enrolled successfully!</p>
        )}
      </div>

      <div className="flex gap-4 justify-center">
        <button onClick={() => navigate(-1)} className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition">
          Cancel
        </button>
        {hasTouchId === true && !enrolled && (
          <button onClick={startScan} disabled={scanning}
            className="flex items-center gap-2 px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition shadow">
            <Fingerprint className="w-5 h-5" />
            {scanning ? 'Scanning...' : 'Start Scan'}
          </button>
        )}
        {hasTouchId === false && (
          <button onClick={() => navigate(-1)} className="px-6 py-2.5 bg-slate-700 text-white rounded-xl font-medium hover:bg-slate-800 transition">
            Go Back
          </button>
        )}
      </div>
    </div>
  );
};

export default FingerprintEnroll;
