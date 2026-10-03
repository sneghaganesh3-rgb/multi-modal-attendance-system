import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Eye, Edit, Trash2, Fingerprint, Camera, Hand } from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../../api/client';

const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];

const StudentList = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [deleteId, setDeleteId] = useState(null); // ID of student pending deletion

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const params = {};
      if (searchTerm) params.search = searchTerm;
      const res = await client.get('/students/', { params });
      // API returns array of students; fetch enrollment status for each
      const list = res.data || [];

      // Attach enrollment status via a second call per student
      const withStatus = await Promise.all(
        list.map(async (s) => {
          try {
            const statusRes = await client.get(`/students/${s.id}/enrollment-status`);
            return { ...s, enrollment: statusRes.data };
          } catch {
            return { ...s, enrollment: { face: false, palm: false, fingerprint: false } };
          }
        })
      );

      setStudents(withStatus);
    } catch (err) {
      toast.error('Failed to load students');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // Search on Enter or when search clears
  const handleSearch = (e) => {
    if (e.key === 'Enter') fetchStudents();
  };

  const handleDelete = async (id) => {
    try {
      await client.delete(`/students/${id}`);
      toast.success('Student removed successfully');
      setDeleteId(null);
      fetchStudents();
    } catch {
      toast.error('Failed to delete student');
    }
  };

  // Client-side department filter (on top of server search)
  const filtered = deptFilter
    ? students.filter((s) => s.department === deptFilter)
    : students;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-800">Students</h1>
        <Link
          to="/students/add"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Student
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by ID or Name — press Enter"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearch}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
        >
          <option value="">All Departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button
          onClick={fetchStudents}
          className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-slate-400">Loading students…</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-slate-400">
            <div className="text-5xl mb-4">🎓</div>
            <p className="font-medium text-slate-600">No students found</p>
            <p className="text-sm mt-1">
              {searchTerm || deptFilter
                ? 'Try adjusting your search or filter.'
                : 'Add your first student using the button above.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-sm">
              <tr>
                <th className="p-4 font-medium">Student ID</th>
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Dept</th>
                <th className="p-4 font-medium">Year / Sec</th>
                <th className="p-4 font-medium text-center">Biometrics</th>
                <th className="p-4 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((student) => (
                <tr key={student.id} className="hover:bg-slate-50/50">
                  <td className="p-4 text-slate-800 font-medium">{student.student_id}</td>
                  <td className="p-4 text-slate-700">{student.name}</td>
                  <td className="p-4 text-slate-600">{student.department}</td>
                  <td className="p-4 text-slate-600">{student.year} / {student.section}</td>

                  {/* Enrollment badges */}
                  <td className="p-4">
                    <div className="flex items-center justify-center gap-2">
                      <span
                        title={student.enrollment?.face ? 'Face enrolled' : 'Face not enrolled'}
                        className={`p-1.5 rounded-md ${student.enrollment?.face ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}
                      >
                        <Camera className="w-4 h-4" />
                      </span>
                      <span
                        title={student.enrollment?.palm ? 'Palm enrolled' : 'Palm not enrolled'}
                        className={`p-1.5 rounded-md ${student.enrollment?.palm ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}
                      >
                        <Hand className="w-4 h-4" />
                      </span>
                      <span
                        title={student.enrollment?.fingerprint ? 'Fingerprint enrolled' : 'Fingerprint not enrolled'}
                        className={`p-1.5 rounded-md ${student.enrollment?.fingerprint ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}
                      >
                        <Fingerprint className="w-4 h-4" />
                      </span>
                    </div>
                  </td>

                  {/* Action buttons */}
                  <td className="p-4">
                    <div className="flex items-center justify-center gap-2">
                      <Link
                        to={`/students/${student.id}`}
                        title="View details"
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                      <Link
                        to={`/students/edit/${student.id}`}
                        title="Edit"
                        className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"
                      >
                        <Edit className="w-4 h-4" />
                      </Link>
                      <button
                        title="Delete"
                        onClick={() => setDeleteId(student.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Delete Student</h3>
            <p className="text-slate-600 text-sm mb-6">
              Are you sure you want to remove this student? All their biometric data and attendance records will be preserved but the student will be deactivated.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentList;
