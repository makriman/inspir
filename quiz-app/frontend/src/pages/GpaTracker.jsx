import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_ITEMS_KEY = 'inspirquiz_grade_items_v1';
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

function percentToGpa(p) {
  if (p >= 90) return 4;
  if (p >= 80) return 3;
  if (p >= 70) return 2;
  if (p >= 60) return 1;
  return 0;
}

export default function GpaTracker() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [courses, setCourses] = useState(() => loadJson(LOCAL_COURSES_KEY, []));
  const [items, setItems] = useState(() => loadJson(LOCAL_ITEMS_KEY, []));
  const [gpa, setGpa] = useState(0);

  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState('');
  const [score, setScore] = useState(85);
  const [maxScore, setMaxScore] = useState(100);
  const [weight, setWeight] = useState(1);

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const [coursesRes, itemsRes, gpaRes] = await Promise.all([
        axios.get(`${API_URL}/organization/courses`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/organization/gpa/items`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/organization/gpa/summary`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setCourses(coursesRes.data.courses || []);
      setItems(itemsRes.data.items || []);
      setGpa(gpaRes.data.gpa || 0);
    } catch (e) {
      console.error(e);
      setError('Failed to load GPA data.');
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
    saveJson(LOCAL_ITEMS_KEY, items);
  }, [items, isAuthed]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_COURSES_KEY, courses);
  }, [courses, isAuthed]);

  const computedLocalGpa = useMemo(() => {
    let weightSum = 0;
    let gpaSum = 0;
    for (const row of items) {
      const max = Math.max(1, Number(row.max_score) || 100);
      const pct = ((Number(row.score) || 0) / max) * 100;
      const g = percentToGpa(pct);
      const w = Math.max(0, Number(row.weight) || 1);
      weightSum += w;
      gpaSum += g * w;
    }
    return weightSum ? Number((gpaSum / weightSum).toFixed(2)) : 0;
  }, [items]);

  useEffect(() => {
    if (isAuthed) return;
    setGpa(computedLocalGpa);
  }, [computedLocalGpa, isAuthed]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/organization/gpa/items`,
          { name: n, course_id: courseId || null, score: Number(score), max_score: Number(maxScore), weight: Number(weight) },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setItems((prev) => [res.data.item, ...prev]);
        const g = await axios.get(`${API_URL}/organization/gpa/summary`, { headers: { Authorization: `Bearer ${token}` } });
        setGpa(g.data.gpa || 0);
        setName('');
      } catch (e) {
        console.error(e);
        setError('Failed to add grade item.');
      }
      return;
    }
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: n,
      course_id: courseId || null,
      score: Number(score),
      max_score: Number(maxScore),
      weight: Number(weight),
      created_at: new Date().toISOString(),
    };
    setItems((prev) => [item, ...prev].slice(0, 1000));
    setName('');
  };

  const remove = async (item) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.delete(`${API_URL}/organization/gpa/items/${item.id}`, { headers: { Authorization: `Bearer ${token}` } });
        const g = await axios.get(`${API_URL}/organization/gpa/summary`, { headers: { Authorization: `Bearer ${token}` } });
        setGpa(g.data.gpa || 0);
      } catch (e) {
        console.error(e);
        setError('Failed to delete grade item.');
        return;
      }
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  const courseName = (id) => courses.find((c) => c.id === id)?.name || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Organization</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">GPA Tracker</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Add grade items and get a simple GPA estimate (4.0 scale).
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: grades save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <h2 className="text-2xl font-bold text-gray-900">Current GPA</h2>
                <div className="text-4xl font-extrabold text-purple-700">{gpa.toFixed(2)}</div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                This is a simple estimate based on weighted grade items.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={load}
                  disabled={!isAuthed || loading}
                  className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
                <Link to="/course-manager" className="px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Courses
                </Link>
              </div>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Add a grade item</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Midterm"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
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
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Weight</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Score</label>
                  <input
                    type="number"
                    min={0}
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Max score</label>
                  <input
                    type="number"
                    min={1}
                    value={maxScore}
                    onChange={(e) => setMaxScore(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
              <button
                onClick={create}
                disabled={!name.trim() || loading}
                className="mt-4 px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all disabled:opacity-50"
              >
                Add grade
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Grade items</h2>
              {items.length === 0 ? (
                <div className="text-sm text-gray-600">No grade items yet.</div>
              ) : (
                <div className="space-y-3">
                  {items.slice(0, 100).map((i) => (
                    <div key={i.id} className="border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-extrabold text-gray-900">{i.name}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          {courseName(i.course_id) ? `${courseName(i.course_id)} • ` : ''}
                          {i.score}/{i.max_score} • weight {i.weight}
                        </div>
                      </div>
                      <button
                        onClick={() => remove(i)}
                        className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-red-300 transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Next</h2>
              <div className="flex flex-wrap gap-2">
                <Link to="/assignment-tracker" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Assignments
                </Link>
                <Link to="/study-planner" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Planner
                </Link>
              </div>
              <div className="mt-4 text-sm text-white/80">
                GPA gets better when your schedule supports the work.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

