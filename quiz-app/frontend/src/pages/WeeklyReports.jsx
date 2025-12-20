import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

function startOfWeekUtc(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday start
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().split('T')[0];
}

export default function WeeklyReports() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState({ enabled: true, cadence: 'weekly', timezone: 'UTC' });
  const [reports, setReports] = useState([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeekUtc());

  useEffect(() => {
    if (!isAuthed) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [prefsRes, reportsRes] = await Promise.all([
          axios.get(`${API_URL}/analytics/reports/preferences`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/analytics/reports/weekly?limit=12`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setPreferences(prefsRes.data.preferences || preferences);
        setReports(reportsRes.data.reports || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load weekly reports.');
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  const savePreferences = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.put(`${API_URL}/analytics/reports/preferences`, preferences, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPreferences(res.data.preferences);
    } catch (e) {
      console.error(e);
      setError('Failed to save preferences.');
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_URL}/analytics/reports/weekly/generate`,
        { week_start: weekStart },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const report = res.data.report;
      setReports((prev) => {
        const filtered = prev.filter((r) => r.week_start !== report.week_start);
        return [report, ...filtered];
      });
    } catch (e) {
      console.error(e);
      setError('Failed to generate report.');
    } finally {
      setLoading(false);
    }
  };

  const sortedReports = useMemo(() => {
    return [...reports].sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
  }, [reports]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">🗓️</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Weekly Reports</h1>
          <p className="text-gray-600 mb-6">
            Sign in to generate a weekly summary of study minutes, deep work, tasks, and habits.
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Analytics</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Weekly Reports</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Generate a weekly “what happened” summary and keep your system honest.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Generate</h2>
                <Link to="/progress-dashboard" className="text-sm text-purple-700 font-semibold hover:underline">
                  View progress dashboard →
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Week start (Monday)</label>
                  <input
                    type="date"
                    value={weekStart}
                    onChange={(e) => setWeekStart(startOfWeekUtc(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                  <div className="text-xs text-gray-500 mt-2">
                    The selected date will snap to the Monday of that week (UTC).
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={generate}
                    disabled={loading}
                    className="w-full px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all disabled:opacity-50"
                  >
                    Generate
                  </button>
                </div>
              </div>

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent reports</h2>
              {sortedReports.length === 0 ? (
                <div className="text-sm text-gray-600">No reports yet. Generate your first one above.</div>
              ) : (
                <div className="space-y-4">
                  {sortedReports.map((r) => {
                    const highlights = r.payload?.highlights || {};
                    return (
                      <div key={r.id} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="font-bold text-gray-900">Week of {r.week_start}</div>
                          <div className="text-xs text-gray-500">
                            Generated {r.payload?.generatedAt ? new Date(r.payload.generatedAt).toLocaleString() : '—'}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-600">Study</div>
                            <div className="font-extrabold text-gray-900">{highlights.totalStudyMinutes || 0}m</div>
                          </div>
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-600">Deep work</div>
                            <div className="font-extrabold text-gray-900">{highlights.deepWorkMinutes || 0}m</div>
                          </div>
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-600">Task timer</div>
                            <div className="font-extrabold text-gray-900">{highlights.taskTimerMinutes || 0}m</div>
                          </div>
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-600">Tasks</div>
                            <div className="font-extrabold text-gray-900">{highlights.completedTasks || 0}</div>
                          </div>
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="text-xs text-gray-600">Habits</div>
                            <div className="font-extrabold text-gray-900">{highlights.habitCheckinsDone || 0}</div>
                          </div>
                        </div>
                        {r.payload?.notes && <div className="text-xs text-gray-500 mt-3">{r.payload.notes}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Preferences</h2>
              <label className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
                <input
                  type="checkbox"
                  checked={Boolean(preferences.enabled)}
                  onChange={(e) => setPreferences((p) => ({ ...p, enabled: e.target.checked }))}
                />
                <span className="font-semibold text-gray-800">Enable reports</span>
              </label>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Timezone</label>
                <input
                  value={preferences.timezone || 'UTC'}
                  onChange={(e) => setPreferences((p) => ({ ...p, timezone: e.target.value }))}
                  placeholder="UTC"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Cadence</label>
                <select
                  value={preferences.cadence || 'weekly'}
                  onChange={(e) => setPreferences((p) => ({ ...p, cadence: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
                >
                  <option value="weekly">Weekly</option>
                </select>
              </div>

              <button
                onClick={savePreferences}
                disabled={loading}
                className="mt-5 w-full px-4 py-3 rounded-xl bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
              >
                Save preferences
              </button>

              <div className="text-xs text-gray-500 mt-3">
                Email delivery is not enabled yet — reports are stored in-app for now.
              </div>
            </div>

            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Pair with</h2>
              <div className="flex flex-wrap gap-2">
                <Link to="/progress-dashboard" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Progress Dashboard
                </Link>
                <Link to="/daily-goals" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Daily Goals
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Status</h2>
              <div className="text-sm text-gray-600">
                {loading ? 'Loading…' : 'Ready.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

