import { useState, useEffect } from 'react';
import { Search, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../../api/client';

const statusColor = (status) => {
  if (!status) return 'bg-slate-100 text-slate-500';
  const s = status.toLowerCase();
  if (s === 'present') return 'bg-green-100 text-green-700';
  if (s === 'late')    return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
};

const AttendanceList = () => {
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const params = {};
      if (dateFilter) {
        params.date_from = dateFilter;
        params.date_to   = dateFilter;
      }
      if (statusFilter) params.status = statusFilter;

      const res = await client.get('/attendance/', { params });
      setRecords(res.data || []);
    } catch (err) {
      toast.error('Failed to load attendance records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [dateFilter, statusFilter]);

  const handleExportCSV = async () => {
    try {
      const params = {};
      if (dateFilter) { params.date_from = dateFilter; params.date_to = dateFilter; }
      const res = await client.get('/reports/export/csv', { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a   = document.createElement('a');
      a.href    = url;
      a.download = 'attendance_report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('CSV export failed');
    }
  };

  // Client-side search by name or student_id
  const filtered = search
    ? records.filter((r) => {
        const q = search.toLowerCase();
        return (
          r.student?.name?.toLowerCase().includes(q) ||
          r.student?.student_id?.toLowerCase().includes(q)
        );
      })
    : records;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-800">Attendance Records</h1>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search student name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
        >
          <option value="">All Status</option>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
        </select>
        <button
          onClick={fetchRecords}
          className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-slate-400">Loading records…</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-slate-400">
            <div className="text-5xl mb-4">📋</div>
            <p className="font-medium text-slate-600">No attendance records found</p>
            <p className="text-sm mt-1">
              {dateFilter || statusFilter || search
                ? 'Try adjusting your filters.'
                : 'Attendance will appear here once students are verified.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500">
                <tr>
                  <th className="p-4">Date &amp; Time</th>
                  <th className="p-4">Student Info</th>
                  <th className="p-4">Department</th>
                  <th className="p-4">Method</th>
                  <th className="p-4">Scores</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/50">
                    <td className="p-4">
                      <div className="font-medium text-slate-800">{record.date}</div>
                      <div className="text-sm text-slate-500">{record.time_in}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-slate-800">{record.student?.name || '—'}</div>
                      <div className="text-sm text-slate-500">{record.student?.student_id || '—'}</div>
                    </td>
                    <td className="p-4 text-slate-600">{record.student?.department || '—'}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-indigo-50 text-indigo-700 capitalize">
                        {record.verification_method || '—'}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      {record.fusion_score != null ? (
                        <span className="font-medium text-indigo-600">
                          {(record.fusion_score * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize ${statusColor(record.status)}`}>
                        {record.status || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttendanceList;
