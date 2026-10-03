import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Camera, Hand, Fingerprint, CheckCircle2, XCircle, ArrowLeft, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../../api/client';

const StudentDetail = () => {
  const { id } = useParams();
  const [student, setStudent] = useState(null);
  const [enrollment, setEnrollment] = useState({ face: false, palm: false, fingerprint: false });
  const [loading, setLoading] = useState(true);
  const [portalPw, setPortalPw] = useState(null); // shown once after it is generated

  const givePortalAccess = async () => {
    if (!window.confirm("Create (or reset) this student's portal password?")) return;
    try {
      const res = await client.post(`/portal/admin/set-password/${id}`, {});
      setPortalPw(res.data.password);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not set the portal password');
    }
  };

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        // Fetch student details
        const res = await client.get(`/students/${id}`);
        setStudent(res.data);
        
        // Fetch enrollment status
        const statusRes = await client.get(`/students/${id}/enrollment-status`);
        setEnrollment(statusRes.data);
      } catch (err) {
        toast.error('Failed to load student details');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [id]);

  if (loading) return <div className="p-10 text-center text-slate-500">Loading student details...</div>;
  if (!student) return <div className="p-10 text-center text-red-500">Student not found</div>;

  const EnrollmentCard = ({ type, isEnrolled, icon: Icon, link }) => (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center text-center">
      <div className={`p-4 rounded-full mb-4 ${isEnrolled ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
        <Icon className="w-8 h-8" />
      </div>
      <h3 className="font-semibold text-lg text-slate-800">{type}</h3>
      <div className="mt-2 flex items-center gap-2">
        {isEnrolled ? (
          <><CheckCircle2 className="w-5 h-5 text-green-500" /><span className="text-green-600 font-medium">Enrolled</span></>
        ) : (
          <><XCircle className="w-5 h-5 text-slate-400" /><span className="text-slate-500">Not Enrolled</span></>
        )}
      </div>
      <Link
        to={link}
        className={`mt-6 w-full py-2.5 rounded-lg text-sm font-medium transition ${
          isEnrolled
            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
        }`}
      >
        {isEnrolled ? 'Re-enroll' : 'Enroll Now'}
      </Link>
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Link to="/students" className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium">
        <ArrowLeft className="w-4 h-4" /> Back to Students
      </Link>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row items-center md:items-start gap-6">
        <div className="w-24 h-24 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-4xl font-bold uppercase shadow-inner">
          {student.name.charAt(0)}
        </div>
        <div className="flex-1 text-center md:text-left">
          <h1 className="text-3xl font-bold text-slate-800">{student.name}</h1>
          <p className="text-slate-500 text-lg mt-1 font-medium">
            {student.student_id} <span className="mx-2 text-slate-300">•</span> {student.department} <span className="mx-2 text-slate-300">•</span> Year {student.year} Sec {student.section}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 justify-center md:justify-start text-sm text-slate-600">
            {student.email && <div>✉️ {student.email}</div>}
            {student.phone && <div>📞 {student.phone}</div>}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold text-slate-800 pt-2">Biometric Enrollment</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <EnrollmentCard type="Face Recognition" isEnrolled={enrollment.face} icon={Camera} link={`/enrollment/${student.id}/face`} />
        <EnrollmentCard type="Palm Print" isEnrolled={enrollment.palm} icon={Hand} link={`/enrollment/${student.id}/palm`} />
        <EnrollmentCard type="Fingerprint" isEnrolled={enrollment.fingerprint} icon={Fingerprint} link={`/enrollment/${student.id}/fingerprint`} />
      </div>

      <h2 className="text-xl font-bold text-slate-800 pt-2">Student Portal Access</h2>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 text-sm text-slate-600">
          Lets the student sign in at <code className="bg-slate-100 px-1 rounded">/portal/login</code> with their student ID
          ({student.student_id}) and see their own attendance. Generating a new password replaces the old one.
          {portalPw && (
            <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-emerald-900">
              Password (shown only now, share it with the student):{' '}
              <code className="font-bold select-all text-base">{portalPw}</code>
            </div>
          )}
        </div>
        <button
          onClick={givePortalAccess}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg shadow-sm"
        >
          <KeyRound className="w-4 h-4" /> {portalPw ? 'Generate again' : 'Give portal access'}
        </button>
      </div>
    </div>
  );
};

export default StudentDetail;
