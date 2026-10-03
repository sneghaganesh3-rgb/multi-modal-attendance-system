import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserCheck, UserX, Clock, UserPlus, Fingerprint } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import StatCard from '../components/StatCard';
import client from '../api/client';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalStudents: 0,
    presentToday: 0,
    absentToday: 0,
    lateToday: 0,
    attendanceRate: 0,
  });

  const [trendData, setTrendData] = useState([]);
  const [recentRecords, setRecentRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true);

        // Fetch attendance stats (totals + 7-day trend)
        const statsRes = await client.get('/attendance/stats');
        const s = statsRes.data;

        const total = s.total_students || 0;
        const present = s.present_today || 0;
        const late = s.late_today || 0;
        const absent = s.absent_today || 0;
        const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

        setStats({
          totalStudents: total,
          presentToday: present,
          absentToday: absent,
          lateToday: late,
          attendanceRate: rate,
        });

        // Build 7-day trend from last_7_days if provided
        if (s.last_7_days && s.last_7_days.length > 0) {
          const trend = s.last_7_days.map((d) => ({
            name: new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' }),
            rate: d.total > 0
              ? Math.round(((d.present + d.late) / d.total) * 100)
              : 0,
          }));
          setTrendData(trend);
        } else {
          setTrendData([]);
        }

        // Fetch today's recent records
        const todayRes = await client.get('/attendance/today');
        const records = (todayRes.data || []).slice(0, 10).map((r) => ({
          id: r.id,
          studentId: r.student?.student_id || '—',
          name: r.student?.name || '—',
          time: r.time_in
            ? new Date(`1970-01-01T${r.time_in}`).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit',
              })
            : '—',
          status: r.status
            ? r.status.charAt(0).toUpperCase() + r.status.slice(1)
            : '—',
        }));
        setRecentRecords(records);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  const pieData = [
    { name: 'Present', value: stats.presentToday },
    { name: 'Absent',  value: stats.absentToday  },
    { name: 'Late',    value: stats.lateToday    },
  ];
  const COLORS = ['#10B981', '#EF4444', '#F59E0B'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard Overview</h1>
        <div className="flex gap-3">
          <Link
            to="/students/add"
            className="bg-white text-indigo-600 px-4 py-2 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" /> Add Student
          </Link>
          <Link
            to="/attendance"
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm"
          >
            <Fingerprint className="w-4 h-4" /> Mark Attendance
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Users}      title="Total Students"  value={loading ? '…' : stats.totalStudents}          color="indigo" />
        <StatCard icon={UserCheck}  title="Present Today"   value={loading ? '…' : stats.presentToday}           color="green"  />
        <StatCard icon={UserX}      title="Absent Today"    value={loading ? '…' : stats.absentToday}            color="red"    />
        <StatCard icon={Clock}      title="Late Today"      value={loading ? '…' : stats.lateToday}              color="yellow" />
        <StatCard icon={UserCheck}  title="Attendance Rate" value={loading ? '…' : `${stats.attendanceRate}%`}   color="indigo" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Line Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 lg:col-span-2">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">7-Day Attendance Trend</h2>
          <div className="h-72">
            {trendData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                No attendance data yet. Mark attendance to see the trend.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Line
                    type="monotone" dataKey="rate" stroke="#4F46E5"
                    strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }}
                    name="Attendance %"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Today's Distribution</h2>
          <div className="h-72">
            {stats.totalStudents === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                No data for today yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={60} outerRadius={80}
                    paddingAngle={5} dataKey="value"
                  >
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Recent Attendance Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="font-semibold text-slate-800">Recent Attendance (Today)</h2>
          <Link to="/attendance/records" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            View All
          </Link>
        </div>
        <div className="overflow-x-auto">
          {recentRecords.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              {loading ? 'Loading…' : 'No attendance marked today yet.'}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-slate-100 text-sm text-slate-500">
                  <th className="p-4 font-medium">Student ID</th>
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Time</th>
                  <th className="p-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="p-4 text-slate-700 font-medium">{record.studentId}</td>
                    <td className="p-4 text-slate-600">{record.name}</td>
                    <td className="p-4 text-slate-600">{record.time}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        record.status === 'Present' ? 'bg-green-100 text-green-700' :
                        record.status === 'Late'    ? 'bg-yellow-100 text-yellow-700' :
                                                     'bg-red-100 text-red-700'
                      }`}>
                        {record.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
