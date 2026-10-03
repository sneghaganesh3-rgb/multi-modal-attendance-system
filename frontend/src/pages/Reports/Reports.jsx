import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Calendar, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import client from '../../api/client';

const TABS = ['daily', 'weekly', 'monthly', 'student'];

const Reports = () => {
  const [activeTab, setActiveTab] = useState('daily');
  const [chartData, setChartData]   = useState([]);
  const [tableData, setTableData]   = useState([]);
  const [loading, setLoading]       = useState(false);

  // Date controls
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  );
  const [studentSearch, setStudentSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);

  // ── Fetch data whenever tab / date changes ──────────────────────────────
  useEffect(() => {
    if (activeTab === 'student') {
      fetchStudents();
    } else {
      fetchReport();
    }
  }, [activeTab, selectedDate, selectedMonth]);

  const fetchStudents = async () => {
    try {
      const res = await client.get('/students/');
      setStudents(res.data || []);
    } catch {
      toast.error('Failed to load students');
    }
  };

  const fetchReport = async () => {
    setLoading(true);
    setTableData([]);
    setChartData([]);
    try {
      let res;
      if (activeTab === 'daily') {
        res = await client.get('/reports/daily', { params: { target_date: selectedDate } });
        setTableData(res.data || []);
        // Daily: one bar with present/late/absent
        const present = (res.data || []).filter(r => r.Status === 'present').length;
        const late    = (res.data || []).filter(r => r.Status === 'late').length;
        const absent  = (res.data || []).filter(r => r.Status === 'absent').length;
        setChartData([{ name: selectedDate, present, late, absent }]);
      } else if (activeTab === 'weekly') {
        res = await client.get('/reports/weekly', { params: { week_start: selectedDate } });
        setTableData(res.data || []);
        buildChartFromRecords(res.data || []);
      } else if (activeTab === 'monthly') {
        const [year, month] = selectedMonth.split('-');
        res = await client.get('/reports/monthly', { params: { year, month } });
        setTableData(res.data || []);
        buildChartFromRecords(res.data || []);
      }
    } catch (err) {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentReport = async (student) => {
    setSelectedStudent(student);
    setLoading(true);
    try {
      const res = await client.get(`/reports/student/${student.id}`);
      setTableData(res.data || []);
    } catch {
      toast.error('Failed to load student report');
    } finally {
      setLoading(false);
    }
  };

  // Group records by date for chart
  const buildChartFromRecords = (records) => {
    const map = {};
    (records || []).forEach((r) => {
      const d = r.Date || r.date || '—';
      if (!map[d]) map[d] = { name: d, present: 0, late: 0, absent: 0 };
      const s = (r.Status || r.status || '').toLowerCase();
      if (s === 'present') map[d].present++;
      else if (s === 'late') map[d].late++;
      else if (s === 'absent') map[d].absent++;
    });
    setChartData(Object.values(map));
  };

  const handleExportCSV = async () => {
    try {
      const params = {};
      if (activeTab === 'daily') { params.date_from = selectedDate; params.date_to = selectedDate; }
      else if (activeTab === 'monthly') {
        const [year, month] = selectedMonth.split('-');
        params.date_from = `${year}-${month}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        params.date_to   = `${year}-${month}-${lastDay}`;
      }
      const res = await client.get('/reports/export/csv', { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url;
      a.download = 'attendance_report.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const handleExportPDF = async () => {
    try {
      const params = {};
      if (activeTab === 'daily') { params.date_from = selectedDate; params.date_to = selectedDate; }
      const res = await client.get('/reports/export/pdf', { params, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url;
      a.download = 'attendance_report.pdf'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('PDF export failed'); }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-800">Attendance Reports</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 text-sm"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setTableData([]); setChartData([]); }}
            className={`px-6 py-3 font-medium capitalize border-b-2 transition ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab} Report
          </button>
        ))}
      </div>

      {/* Date controls */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-wrap gap-4 items-center">
        {(activeTab === 'daily' || activeTab === 'weekly') && (
          <div className="flex items-center gap-2 border border-slate-200 px-3 py-2 rounded-lg">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="outline-none text-sm text-slate-700 bg-transparent"
            />
          </div>
        )}
        {activeTab === 'monthly' && (
          <div className="flex items-center gap-2 border border-slate-200 px-3 py-2 rounded-lg">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="outline-none text-sm text-slate-700 bg-transparent"
            />
          </div>
        )}
        {activeTab === 'student' && (
          <input
            type="text"
            placeholder="Search student by name or ID…"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            className="border border-slate-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 w-72"
          />
        )}
        {activeTab !== 'student' && (
          <button
            onClick={fetchReport}
            className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm font-medium"
          >
            Load Report
          </button>
        )}
      </div>

      {/* Student picker (student tab) */}
      {activeTab === 'student' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          {students
            .filter((s) => {
              const q = studentSearch.toLowerCase();
              return (
                !q ||
                s.name?.toLowerCase().includes(q) ||
                s.student_id?.toLowerCase().includes(q)
              );
            })
            .map((s) => (
              <button
                key={s.id}
                onClick={() => fetchStudentReport(s)}
                className={`w-full text-left px-5 py-3 border-b border-slate-100 hover:bg-indigo-50 flex justify-between items-center text-sm ${
                  selectedStudent?.id === s.id ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-700'
                }`}
              >
                <span>{s.name}</span>
                <span className="text-slate-400">{s.student_id} • {s.department}</span>
              </button>
            ))}
          {students.length === 0 && (
            <div className="p-10 text-center text-slate-400 text-sm">No students in the system yet.</div>
          )}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 capitalize">{activeTab} Overview</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} />
                <Legend />
                <Bar dataKey="present" fill="#10B981" radius={[4,4,0,0]} name="Present" />
                <Bar dataKey="late"    fill="#F59E0B" radius={[4,4,0,0]} name="Late"    />
                <Bar dataKey="absent"  fill="#EF4444" radius={[4,4,0,0]} name="Absent"  />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Records table */}
      {(tableData.length > 0 || loading) && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h2 className="font-semibold text-slate-800">
              {activeTab === 'student' && selectedStudent
                ? `${selectedStudent.name} — Attendance History`
                : 'Records'}
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-slate-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 border-b text-slate-500">
                  <tr>
                    {activeTab !== 'student' && <th className="p-4">Student ID</th>}
                    {activeTab !== 'student' && <th className="p-4">Name</th>}
                    <th className="p-4">Date</th>
                    <th className="p-4">Time</th>
                    <th className="p-4">Method</th>
                    <th className="p-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tableData.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      {activeTab !== 'student' && <td className="p-4 text-slate-700 font-medium">{r['Student ID'] || r.student_id || '—'}</td>}
                      {activeTab !== 'student' && <td className="p-4 text-slate-700">{r['Name'] || r.name || '—'}</td>}
                      <td className="p-4 text-slate-600">{r['Date'] || r.date || '—'}</td>
                      <td className="p-4 text-slate-600">{r['Time In'] || r.time_in || '—'}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs capitalize">
                          {r['Method'] || r.method || r.verification_method || '—'}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize ${
                          (r['Status'] || r.status || '').toLowerCase() === 'present' ? 'bg-green-100 text-green-700' :
                          (r['Status'] || r.status || '').toLowerCase() === 'late'    ? 'bg-yellow-100 text-yellow-700' :
                                                                                        'bg-red-100 text-red-700'
                        }`}>
                          {r['Status'] || r.status || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && tableData.length === 0 && chartData.length === 0 && activeTab !== 'student' && (
        <div className="bg-white rounded-xl p-16 text-center shadow-sm border border-slate-100 text-slate-400">
          <div className="text-5xl mb-4">📊</div>
          <p className="font-medium text-slate-600">No data for this period</p>
          <p className="text-sm mt-1">Select a date and click Load Report, or mark some attendance first.</p>
        </div>
      )}
    </div>
  );
};

export default Reports;
