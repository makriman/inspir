import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_ASSIGNMENTS_KEY = 'inspirquiz_assignments_v1';
const LOCAL_COURSES_KEY = 'inspirquiz_courses_v1';

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

function isoNowLocalMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export default function AssignmentTracker() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [courses, setCourses] = useState(() => loadJson(LOCAL_COURSES_KEY, []));
  const [assignments, setAssignments] = useState(() => loadJson(LOCAL_ASSIGNMENTS_KEY, []));

  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [courseId, setCourseId] = useState('');
  const [priority, setPriority] = useState(2);

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const [coursesRes, assignmentsRes] = await Promise.all([
        axios.get(`${API_URL}/organization/courses`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/organization/assignments`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setCourses(coursesRes.data.courses || []);
      setAssignments(assignmentsRes.data.assignments || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load assignments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_ASSIGNMENTS_KEY, assignments);
  }, [assignments, isAuthed]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_COURSES_KEY, courses);
  }, [courses, isAuthed]);

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/organization/assignments`,
          {
            title: t,
            due_at: dueAt ? new Date(dueAt).toISOString() : null,
            course_id: courseId || null,
            priority,
            status: 'todo',
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setAssignments((prev) => [...prev, res.data.assignment]);
        setTitle('');
        setDueAt('');
        setCourseId('');
        setPriority(2);
      } catch (e) {
        console.error(e);
        setError('Failed to create assignment.');
      }
      return;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: t,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      course_id: courseId || null,
      priority,
      status: 'todo',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setAssignments((prev) => [entry, ...prev].slice(0, 500));
    setTitle('');
    setDueAt('');
    setCourseId('');
    setPriority(2);
  };

  const updateStatus = async (assignment, status) => {
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.patch(
          `${API_URL}/organization/assignments/${assignment.id}`,
          { status },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? res.data.assignment : a)));
      } catch (e) {
        console.error(e);
        setError('Failed to update.');
      }
      return;
    }
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignment.id ? { ...a, status, updated_at: new Date().toISOString() } : a))
    );
  };

  const remove = async (assignment) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.delete(`${API_URL}/organization/assignments/${assignment.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        console.error(e);
        setError('Failed to delete.');
        return;
      }
    }
    setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
  };

  const courseName = (id) => courses.find((c) => c.id === id)?.name || null;

  const sorted = useMemo(() => {
    const p = { 1: 0, 2: 1, 3: 2 };
    return [...assignments].sort((a, b) => {
      const aDone = a.status === 'done';
      const bDone = b.status === 'done';
      if (aDone !== bDone) return aDone ? 1 : -1;
      const ap = p[a.priority] ?? 1;
      const bp = p[b.priority] ?? 1;
      if (ap !== bp) return ap - bp;
      const ad = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
  }, [assignments]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Organization</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Assignment Tracker</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Track what’s due, prioritize it, and keep your workload under control.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: assignments save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Add an assignment</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Essay draft"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Due (optional)</label>
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDueAt(isoNowLocalMinute())}
                    className="mt-2 text-xs text-purple-700 font-semibold hover:underline"
                  >
                    Set to now
                  </button>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Course (optional)</label>
                  <select
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
                  >
                    <option value="">—</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
                  >
                    <option value={1}>High</option>
                    <option value={2}>Medium</option>
                    <option value={3}>Low</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={create}
                  disabled={!title.trim() || loading}
                  className="px-6 py-3 rounded-xl bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={load}
                  disabled={!isAuthed || loading}
                  className="px-4 py-3 rounded-xl bg-white border border-gray-200 text-gray-900 font-bold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Assignments</h2>
              {sorted.length === 0 ? (
                <div className="text-sm text-gray-600">No assignments yet.</div>
              ) : (
                <div className="space-y-3">
                  {sorted.slice(0, 100).map((a) => (
                    <div key={a.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-extrabold text-gray-900">{a.title}</div>
                          <div className="text-sm text-gray-600 mt-1">
                            {courseName(a.course_id) ? `${courseName(a.course_id)} • ` : ''}
                            {a.due_at ? `Due ${new Date(a.due_at).toLocaleString()}` : 'No due date'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Status: <span className="font-bold">{a.status}</span> • Priority: {a.priority}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {a.status !== 'done' && (
                            <button
                              onClick={() => updateStatus(a, 'done')}
                              className="px-3 py-2 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 transition-all"
                            >
                              Mark done
                            </button>
                          )}
                          {a.status !== 'in-progress' && a.status !== 'done' && (
                            <button
                              onClick={() => updateStatus(a, 'in-progress')}
                              className="px-3 py-2 rounded-lg bg-gray-900 text-white font-bold hover:bg-gray-800 transition-all"
                            >
                              Start
                            </button>
                          )}
                          {a.status !== 'todo' && a.status !== 'done' && (
                            <button
                              onClick={() => updateStatus(a, 'todo')}
                              className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-bold hover:border-purple-300 transition-all"
                            >
                              Backlog
                            </button>
                          )}
                          <button
                            onClick={() => remove(a)}
                            className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-bold hover:border-red-300 transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Pair with</h2>
              <div className="flex flex-wrap gap-2">
                <Link to="/study-planner" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Planner
                </Link>
                <Link to="/course-manager" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Courses
                </Link>
              </div>
              <div className="mt-4 text-sm text-white/80">
                If it’s not planned and not tracked, it’s easy to forget.
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Next</h2>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link to="/schedule-builder" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Schedule Builder
                </Link>
                <Link to="/task-timer" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Task Timer
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

