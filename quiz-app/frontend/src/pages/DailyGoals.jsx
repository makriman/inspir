import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_SETTINGS_KEY = 'inspirquiz_daily_goals_settings_v1';
const LOCAL_PROGRESS_KEY = 'inspirquiz_daily_goals_progress_v1';

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function pct(done, target) {
  if (!target) return 0;
  return Math.min(100, Math.max(0, Math.round((done / target) * 100)));
}

export default function DailyGoals() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [settings, setSettings] = useState(() => loadJson(LOCAL_SETTINGS_KEY, null) || {
    target_minutes: 60,
    target_sessions: 2,
    target_tasks: 3,
  });
  const [progress, setProgress] = useState(() => {
    const local = loadJson(LOCAL_PROGRESS_KEY, {});
    const date = todayDate();
    return local[date] || { goal_date: date, minutes_done: 0, sessions_done: 0, tasks_done: 0 };
  });

  useEffect(() => {
    const boot = async () => {
      if (!isAuthed) return;
      setLoading(true);
      setError('');
      try {
        const [settingsRes, progressRes] = await Promise.all([
          axios.get(`${API_URL}/goals/daily/settings`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/goals/daily/today`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setSettings(settingsRes.data.settings);
        setProgress(progressRes.data.progress);
      } catch (e) {
        console.error(e);
        setError('Failed to load goals. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_SETTINGS_KEY, settings);
  }, [settings, isAuthed]);

  useEffect(() => {
    if (isAuthed) return;
    const all = loadJson(LOCAL_PROGRESS_KEY, {});
    all[progress.goal_date] = progress;
    saveJson(LOCAL_PROGRESS_KEY, all);
  }, [progress, isAuthed]);

  const saveSettings = async () => {
    if (!isAuthed) return;
    setSaving(true);
    setError('');
    try {
      const res = await axios.put(`${API_URL}/goals/daily/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSettings(res.data.settings);
    } catch (e) {
      console.error(e);
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const increment = async ({ minutes = 0, sessions = 0, tasks = 0 }) => {
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/goals/daily/today/increment`,
          { minutes_delta: minutes, sessions_delta: sessions, tasks_delta: tasks },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setProgress(res.data.progress);
      } catch (e) {
        console.error(e);
        setError('Failed to update progress.');
      }
      return;
    }

    setProgress((p) => ({
      ...p,
      minutes_done: Math.max(0, (p.minutes_done || 0) + minutes),
      sessions_done: Math.max(0, (p.sessions_done || 0) + sessions),
      tasks_done: Math.max(0, (p.tasks_done || 0) + tasks),
      updated_at: new Date().toISOString(),
    }));
  };

  const stats = useMemo(() => {
    const minutesTarget = Math.max(0, settings.target_minutes || 0);
    const sessionsTarget = Math.max(0, settings.target_sessions || 0);
    const tasksTarget = Math.max(0, settings.target_tasks || 0);
    return {
      minutes: { done: progress.minutes_done || 0, target: minutesTarget, percent: pct(progress.minutes_done || 0, minutesTarget) },
      sessions: { done: progress.sessions_done || 0, target: sessionsTarget, percent: pct(progress.sessions_done || 0, sessionsTarget) },
      tasks: { done: progress.tasks_done || 0, target: tasksTarget, percent: pct(progress.tasks_done || 0, tasksTarget) },
    };
  }, [settings, progress]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Daily Study Goals</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Decide what a “good day” looks like — then hit it consistently.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: your goals save to this device only.{' '}
              <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Today</h2>
                <div className="text-sm text-gray-500">Date: {progress.goal_date}</div>
              </div>

              <div className="space-y-4">
                {[
                  { label: 'Minutes', icon: '⏱️', stat: stats.minutes },
                  { label: 'Sessions', icon: '📌', stat: stats.sessions },
                  { label: 'Tasks', icon: '✅', stat: stats.tasks },
                ].map((row) => (
                  <div key={row.label} className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-bold text-gray-900">
                        <span className="mr-2">{row.icon}</span>
                        {row.label}
                      </div>
                      <div className="text-sm text-gray-700 font-semibold">
                        {row.stat.done} / {row.stat.target}
                      </div>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-3">
                      <div className="h-2 bg-purple-600 rounded-full" style={{ width: `${row.stat.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-sm font-bold text-gray-900 mb-3">Add minutes</div>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 25].map((m) => (
                      <button
                        key={m}
                        onClick={() => increment({ minutes: m })}
                        className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all"
                      >
                        +{m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-sm font-bold text-gray-900 mb-3">Add sessions</div>
                  <button
                    onClick={() => increment({ sessions: 1 })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-gray-800 transition-all"
                  >
                    +1 session
                  </button>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="text-sm font-bold text-gray-900 mb-3">Add tasks</div>
                  <button
                    onClick={() => increment({ tasks: 1 })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all"
                  >
                    +1 task
                  </button>
                </div>
              </div>

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Goal settings</h2>
                {isAuthed && (
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Minutes / day</label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={settings.target_minutes}
                    onChange={(e) => setSettings((s) => ({ ...s, target_minutes: clampInt(e.target.value, 0, 600, 60) }))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Sessions / day</label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={settings.target_sessions}
                    onChange={(e) => setSettings((s) => ({ ...s, target_sessions: clampInt(e.target.value, 0, 20, 2) }))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Tasks / day</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={settings.target_tasks}
                    onChange={(e) => setSettings((s) => ({ ...s, target_tasks: clampInt(e.target.value, 0, 50, 3) }))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="text-xs text-gray-500 mt-4">
                Pro tip: keep targets small at first. Consistency beats intensity.
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Suggested workflow</h2>
              <ol className="space-y-2 text-sm text-white/80 list-decimal list-inside">
                <li>Set a tiny daily goal.</li>
                <li>Use <span className="text-white font-semibold">Task Timer</span> for focused tasks.</li>
                <li>Use <span className="text-white font-semibold">Deep Work</span> for structured cycles.</li>
                <li>Review progress weekly and adjust.</li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/task-timer" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Task Timer
                </Link>
                <Link to="/deep-work" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Deep Work
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Status</h2>
              <div className="text-sm text-gray-600">
                {loading ? 'Loading…' : 'Ready.'}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Your data is stored per-account when signed in, and locally in guest mode.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

