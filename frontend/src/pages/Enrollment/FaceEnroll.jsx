import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MultiShotCapture from '../../components/MultiShotCapture';
import toast from 'react-hot-toast';
import client from '../../api/client';

const FaceEnroll = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [images, setImages] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!images) return toast.error('Please capture all shots first');
    setLoading(true);
    try {
      await client.post(`/enrollment/face/${id}`, { images });
      toast.success('Face enrolled successfully!');
      navigate(`/students/${id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to enroll face');
      setImages(null);
      setAttempt((a) => a + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white p-6 rounded-xl shadow-sm border border-slate-100 text-center">
      <h1 className="text-2xl font-bold mb-2">Face Enrollment</h1>
      <p className="text-slate-500 mb-6">Student ID: {id}</p>
      
      <MultiShotCapture key={attempt} mode="face" shots={3} onComplete={setImages} />

      <div className="mt-8 flex gap-4 justify-center">
        <button onClick={() => navigate(-1)} className="px-6 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Cancel</button>
        <button 
          onClick={handleSubmit} 
          disabled={!images || loading} 
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Submit Enrollment'}
        </button>
      </div>
    </div>
  );
};

export default FaceEnroll;
