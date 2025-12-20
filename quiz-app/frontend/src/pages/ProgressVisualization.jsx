import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

function sumBy(list, key) {
  const map = new Map();
  for (const item of list || []) {
    const k = item[key] || 'unknown';
    map.set(k, (map.get(k) || 0) + (item.total_time_minutes || 0));
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function minutesToHours(minutes) {
  const m = Number(minutes) || 0;
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

const COLORS = ['bg-purple-600', 'bg-cyan-600', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600'];

export default function ProgressVisualization() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    if (!isAuthed) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`${API_URL}/analytics/progress/overview?days=${days}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setOverview(res.data);
      } catch (e) {
        console.error(e);
        setError('Failed to load analytics.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthed, token, days]);

  const activityBreakdown = useMemo(() => {
    const activity = overview?.raw?.studyActivity || [];
    const pairs = sumBy(activity, 'activity_type');
    const total = pairs.reduce((s, [, v]) => s + v, 0) || 1;
    return pairs.map(([type, minutes], idx) => ({
      type,
      minutes,
      percent: Math.round((minutes / total) * 100),
      color: COLORS[idx % COLORS.length],
    }));
  }, [overview]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">📊</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Progress Visualization</h1>
          <p className="text-gray-600 mb-6">
            Sign in to visualize your study activity breakdown and see trends over time.
          </p>
          <Link
            to="/auth"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-700 transition-all"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const totals = overview?.totals || {};
  const totalStudy = totals.studyMinutes || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Analytics</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Progress Visualization</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Visualize what you did — so you can do more of what works.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-2xl font-bold text-gray-900">Window</h2>
            <div className="flex items-center gap-2">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    days === d ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="text-sm text-gray-600 mt-3">
            Total study activity: <span className="font-extrabold text-gray-900">{minutesToHours(totalStudy)}</span>
          </div>
          {loading && <div className="mt-3 text-sm text-gray-500">Loading…</div>}
          {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Activity breakdown</h2>
              {activityBreakdown.length === 0 ? (
                <div className="text-sm text-gray-600">No activity yet — use Study Timer or Deep Work to start tracking.</div>
              ) : (
                <div className="space-y-3">
                  {activityBreakdown.map((row) => (
                    <div key={row.type} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold text-gray-900 capitalize">{row.type.replaceAll('-', ' ')}</div>
                        <div className="text-sm text-gray-700 font-semibold">{minutesToHours(row.minutes)} • {row.percent}%</div>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-3">
                        <div className={`h-2 ${row.color} rounded-full`} style={{ width: `${Math.max(2, row.percent)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Actions</h2>
              <div className="flex flex-wrap gap-2">
                <Link to="/progress-dashboard" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Dashboard
                </Link>
                <Link to="/weekly-reports" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Weekly Reports
                </Link>
              </div>
              <div className="mt-4 text-sm text-white/80">
                Use this to decide what to double down on next week.
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Track more</h2>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link to="/study-timer" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Study Timer
                </Link>
                <Link to="/deep-work" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Deep Work
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

