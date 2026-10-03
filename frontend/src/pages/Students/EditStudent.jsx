import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Camera, Hand, Fingerprint } from 'lucide-react';
import client from '../../api/client';

const EditStudent = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enrollment, setEnrollment] = useState({ face: false, palm: false, fingerprint: false });
  const [formData, setFormData] = useState({
    student_id: '',
    name: '',
    department: 'CSE',
    year: '1',
    section: 'A',
    email: '',
    phone: ''
  });

  useEffect(() => {
    fetchStudentDetails();
  }, [id]);

  const fetchStudentDetails = async () => {
    try {
      const res = await client.get(`/students/${id}`);
      setFormData({
        student_id: res.data.student_id,
        name: res.data.name,
        department: res.data.department || 'CSE',
        year: res.data.year?.toString() || '1',
        section: res.data.section || 'A',
        email: res.data.email || '',
        phone: res.data.phone || ''
      });
      
      const enrollRes = await client.get(`/students/${id}/enrollment-status`);
      setEnrollment(enrollRes.data);
    } catch (err) {
      toast.error('Failed to load student details');
      navigate('/students');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await client.put(`/students/${id}`, {
        name: formData.name,
        department: formData.department,
        year: parseInt(formData.year),
        section: formData.section,
        email: formData.email || null,
        phone: formData.phone || null
      });
      toast.success('Student updated successfully!');
      navigate(`/students/${id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading student details...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Biometric Edit Quick Links */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Modify Biometric Details</h2>
        <p className="text-sm text-slate-500 mb-4">Click below to update or re-enroll this student's biometric data.</p>
        <div className="flex flex-wrap gap-4">
          <button 
            onClick={() => navigate(`/enrollment/${id}/face`)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 font-medium transition ${enrollment.face ? 'border-green-500 text-green-700 bg-green-50 hover:bg-green-100' : 'border-slate-200 text-slate-600 hover:border-indigo-500 hover:text-indigo-600'}`}
          >
            <Camera className="w-5 h-5" />
            {enrollment.face ? 'Update Face' : 'Enroll Face'}
          </button>
          
          <button 
            onClick={() => navigate(`/enrollment/${id}/palm`)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 font-medium transition ${enrollment.palm ? 'border-green-500 text-green-700 bg-green-50 hover:bg-green-100' : 'border-slate-200 text-slate-600 hover:border-indigo-500 hover:text-indigo-600'}`}
          >
            <Hand className="w-5 h-5" />
            {enrollment.palm ? 'Update Palm' : 'Enroll Palm'}
          </button>
          
          <button 
            onClick={() => navigate(`/enrollment/${id}/fingerprint`)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 font-medium transition ${enrollment.fingerprint ? 'border-green-500 text-green-700 bg-green-50 hover:bg-green-100' : 'border-slate-200 text-slate-600 hover:border-indigo-500 hover:text-indigo-600'}`}
          >
            <Fingerprint className="w-5 h-5" />
            {enrollment.fingerprint ? 'Update Fingerprint' : 'Enroll Fingerprint'}
          </button>
        </div>
      </div>

      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">Edit Text Details</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Student ID (Read-only)</label>
              <input type="text" className="w-full px-4 py-2 border border-slate-200 bg-slate-50 text-slate-500 rounded-lg outline-none cursor-not-allowed" disabled
                value={formData.student_id} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input type="text" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" required
                value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
              <select className="w-full px-4 py-2 border rounded-lg outline-none" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})}>
                <option>CSE</option><option>IT</option><option>ECE</option><option>EEE</option><option>MECH</option><option>CIVIL</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
              <select className="w-full px-4 py-2 border rounded-lg outline-none" value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})}>
                <option>1</option><option>2</option><option>3</option><option>4</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Section</label>
              <select className="w-full px-4 py-2 border rounded-lg outline-none" value={formData.section} onChange={e => setFormData({...formData, section: e.target.value})}>
                <option>A</option><option>B</option><option>C</option><option>D</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" className="w-full px-4 py-2 border rounded-lg outline-none"
                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="text" className="w-full px-4 py-2 border rounded-lg outline-none"
                value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
            </div>
          </div>
          <div className="pt-6 flex gap-4">
            <button type="submit" disabled={saving} className="bg-indigo-600 text-white px-8 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Text Details'}
            </button>
            <button type="button" onClick={() => navigate(-1)} className="bg-slate-100 text-slate-700 px-6 py-2.5 rounded-lg font-medium hover:bg-slate-200">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditStudent;
