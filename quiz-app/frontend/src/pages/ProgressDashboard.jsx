import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

function minutesToHours(minutes) {
  const hours = minutes / 60;
  if (hours < 1) return `${minutes}m`;
  return `${hours.toFixed(1)}h`;
}

function groupStudyMinutesByDate(studyActivity) {
  const map = new Map();
  for (const row of studyActivity || []) {
    const date = row.activity_date;
    const next = (map.get(date) || 0) + (row.total_time_minutes || 0);
    map.set(date, next);
  }
  return map;
}

export default function ProgressDashboard() {
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
        setError('Failed to load progress.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthed, token, days]);

  const chart = useMemo(() => {
    const activity = overview?.raw?.studyActivity || [];
    const map = groupStudyMinutesByDate(activity);
    const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const max = entries.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
    const last = entries.slice(-Math.min(entries.length, days));
    return { last, max };
  }, [overview, days]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">📈</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Progress Dashboard</h1>
          <p className="text-gray-600 mb-6">
            Sign in to see your study activity totals, deep work time, tasks completed, and more.
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
  const todayGoals = overview?.today?.goals || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Analytics</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Progress Dashboard</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            See what’s working: minutes studied, deep work, task execution, and habit consistency.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Totals (last {overview?.windowDays || days} days)</h2>
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Study minutes</div>
                  <div className="text-2xl font-extrabold text-gray-900 mt-1">{minutesToHours(totals.studyMinutes || 0)}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Deep work</div>
                  <div className="text-2xl font-extrabold text-gray-900 mt-1">{minutesToHours(totals.deepWorkMinutes || 0)}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Task timer</div>
                  <div className="text-2xl font-extrabold text-gray-900 mt-1">{minutesToHours(totals.taskTimerMinutes || 0)}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Tasks completed</div>
                  <div className="text-2xl font-extrabold text-gray-900 mt-1">{totals.completedTasks || 0}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Habit check-ins</div>
                  <div className="text-2xl font-extrabold text-gray-900 mt-1">{totals.habitCheckinsDone || 0}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Today goals</div>
                  <div className="text-sm text-gray-800 font-semibold mt-2">
                    {todayGoals ? (
                      <>
                        {todayGoals.minutes_done}m • {todayGoals.sessions_done} sessions • {todayGoals.tasks_done} tasks
                      </>
                    ) : (
                      'No data yet'
                    )}
                  </div>
                </div>
              </div>

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Study minutes by day</h2>
                <div className="text-sm text-gray-500">Bars show summed study activity.</div>
              </div>

              <div className="h-48 flex items-end gap-1 overflow-x-auto border border-gray-100 rounded-xl p-3 bg-gradient-to-b from-white to-gray-50">
                {chart.last.length === 0 && (
                  <div className="text-sm text-gray-600">No activity yet — use Study Timer or Deep Work to start tracking.</div>
                )}
                {chart.last.map(([date, minutes]) => {
                  const height = Math.max(2, Math.round((minutes / chart.max) * 100));
                  return (
                    <div key={date} className="flex flex-col items-center justify-end w-4">
                      <div
                        className="w-3 rounded-md bg-purple-600"
                        style={{ height: `${height}%` }}
                        title={`${date}: ${minutes}m`}
                      />
                      <div className="text-[10px] text-gray-500 mt-1 rotate-90 origin-top-left whitespace-nowrap">
                        {date.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/study-timer" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Study Timer
                </Link>
                <Link to="/deep-work" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Deep Work
                </Link>
                <Link to="/task-timer" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Task Timer
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Next actions</h2>
              <ul className="space-y-2 text-sm text-white/80">
                <li>• Set daily targets you can hit.</li>
                <li>• Do at least one deep work block.</li>
                <li>• Close the loop with a weekly report.</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/daily-goals" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Daily Goals
                </Link>
                <Link to="/weekly-reports" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Weekly Reports
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Status</h2>
              <div className="text-sm text-gray-600">
                {loading ? 'Loading…' : 'Ready.'}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Analytics are computed from your study activity, tasks, deep work sessions, and goals.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

