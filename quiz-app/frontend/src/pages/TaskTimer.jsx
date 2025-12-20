import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const LOCAL_TASKS_KEY = 'inspirquiz_task_timer_tasks_v1';
const LOCAL_SESSIONS_KEY = 'inspirquiz_task_timer_sessions_v1';

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

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function TaskTimer() {
  const { session, user } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [tasks, setTasks] = useState(() => loadJson(LOCAL_TASKS_KEY, []));
  const [sessions, setSessions] = useState(() => loadJson(LOCAL_SESSIONS_KEY, []));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  const [activeTaskId, setActiveTaskId] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!isAuthed) return;
    const load = async () => {
      setLoading(true);
      try {
        const [tasksRes, sessionsRes] = await Promise.all([
          axios.get(`${API_URL}/productivity/task-timer/tasks`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/productivity/task-timer/sessions?days=30`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setTasks(tasksRes.data.tasks || []);
        setSessions(sessionsRes.data.sessions || []);
      } catch (error) {
        console.error('Failed to load task timer data:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthed, token]);

  useEffect(() => {
    if (!isAuthed) saveJson(LOCAL_TASKS_KEY, tasks);
  }, [tasks, isAuthed]);

  useEffect(() => {
    if (!isAuthed) saveJson(LOCAL_SESSIONS_KEY, sessions);
  }, [sessions, isAuthed]);

  useEffect(() => {
    if (!isRunning) {
      clearInterval(intervalRef.current);
      return undefined;
    }
    intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId) || null, [tasks, activeTaskId]);

  const totals = useMemo(() => {
    const totalSeconds = sessions.reduce((sum, s) => sum + (s.duration_seconds || s.durationSeconds || 0), 0);
    return {
      totalMinutes: Math.round(totalSeconds / 60),
      sessions: sessions.length,
    };
  }, [sessions]);

  const addTask = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    if (isAuthed) {
      const res = await axios.post(
        `${API_URL}/productivity/task-timer/tasks`,
        { title: trimmed, notes: notes.trim() || null },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTasks((prev) => [res.data.task, ...prev]);
    } else {
      const task = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: trimmed,
        notes: notes.trim() || null,
        is_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setTasks((prev) => [task, ...prev].slice(0, 200));
    }

    setTitle('');
    setNotes('');
  };

  const toggleComplete = async (task) => {
    if (isAuthed) {
      const res = await axios.patch(
        `${API_URL}/productivity/task-timer/tasks/${task.id}`,
        { is_completed: !task.is_completed },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTasks((prev) => prev.map((t) => (t.id === task.id ? res.data.task : t)));
      return;
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, is_completed: !t.is_completed, updated_at: new Date().toISOString() } : t))
    );
  };

  const removeTask = async (task) => {
    if (isAuthed) {
      await axios.delete(`${API_URL}/productivity/task-timer/tasks/${task.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    if (activeTaskId === task.id) {
      setActiveTaskId(null);
      setIsRunning(false);
      setSeconds(0);
      setStartedAt(null);
    }
  };

  const start = () => {
    setIsRunning(true);
    setSeconds(0);
    setStartedAt(new Date().toISOString());
  };

  const stopAndSave = async () => {
    setIsRunning(false);
    const endedAt = new Date().toISOString();
    const payload = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      task_id: activeTaskId,
      duration_seconds: seconds,
      started_at: startedAt,
      ended_at: endedAt,
      created_at: endedAt,
    };

    if (seconds > 0) {
      if (isAuthed) {
        const res = await axios.post(
          `${API_URL}/productivity/task-timer/sessions`,
          {
            task_id: activeTaskId,
            duration_seconds: seconds,
            started_at: startedAt,
            ended_at: endedAt,
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSessions((prev) => [res.data.session, ...prev]);
        try {
          await axios.post(
            `${API_URL}/streaks/activity`,
            { activityType: 'task-timer', timeMinutes: Math.round(seconds / 60) },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch {
          // ignore
        }
      } else {
        setSessions((prev) => [payload, ...prev].slice(0, 500));
      }
    }

    setSeconds(0);
    setStartedAt(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Task Timer</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Time tasks, save sessions, and see where your study time really goes.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              You’re in guest mode — tasks and sessions save to this device only. Sign in to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Create a task</h2>
              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title (e.g., Review Chapter 3)"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={3}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={addTask}
                  disabled={!title.trim() || loading}
                  className={`w-full py-3 rounded-lg font-semibold transition-all ${
                    title.trim() && !loading
                      ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-md'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  Add task
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
                {loading && <span className="text-sm text-gray-500">Loading…</span>}
              </div>

              {tasks.length === 0 ? (
                <div className="text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-6">
                  No tasks yet. Add one above.
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.slice(0, 50).map((task) => (
                    <div
                      key={task.id}
                      className={`border rounded-xl p-4 transition-all ${
                        activeTaskId === task.id ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleComplete(task)}
                              className={`w-6 h-6 rounded border flex items-center justify-center ${
                                task.is_completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'
                              }`}
                              title="Mark complete"
                            >
                              {task.is_completed ? '✓' : ''}
                            </button>
                            <button
                              onClick={() => setActiveTaskId(task.id)}
                              className="text-left font-semibold text-gray-900 hover:text-purple-700 truncate"
                            >
                              {task.title}
                            </button>
                          </div>
                          {task.notes && <div className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{task.notes}</div>}
                        </div>
                        <button
                          onClick={() => removeTask(task)}
                          className="text-sm font-semibold text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>

                      {activeTaskId === task.id && (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          {!isRunning ? (
                            <button
                              onClick={start}
                              className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all"
                            >
                              Start
                            </button>
                          ) : (
                            <button
                              onClick={stopAndSave}
                              className="px-4 py-2 rounded-lg font-semibold bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all"
                            >
                              Stop & Save
                            </button>
                          )}
                          <div className="font-mono text-lg text-gray-900">{formatSeconds(seconds)}</div>
                          {isRunning && (
                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-bold">
                              Running
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {tasks.length > 50 && <div className="text-sm text-gray-500">Showing first 50 tasks.</div>}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">This device</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Sessions</div>
                  <div className="text-2xl font-bold text-gray-900">{totals.sessions}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div className="text-sm text-gray-600">Total minutes</div>
                  <div className="text-2xl font-bold text-gray-900">{totals.totalMinutes}</div>
                </div>
              </div>
              {activeTask && (
                <div className="mt-4 text-sm text-gray-600">
                  Selected: <span className="font-semibold text-gray-900">{activeTask.title}</span>
                </div>
              )}
              {isAuthed && (
                <div className="mt-4 text-xs text-gray-500">
                  Signed in as <span className="font-semibold">{user?.username}</span>. Sessions sync to your account.
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Recent sessions</h2>
              {sessions.length === 0 ? (
                <div className="text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-4">
                  No sessions yet. Start a timer on a task.
                </div>
              ) : (
                <div className="space-y-3">
                  {sessions.slice(0, 10).map((s) => (
                    <div key={s.id} className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900">⏱️ {Math.round((s.duration_seconds || s.durationSeconds || 0) / 60)} min</div>
                        <div className="text-xs text-gray-500">{new Date(s.created_at || s.createdAt || Date.now()).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

