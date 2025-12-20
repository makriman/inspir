import { useEffect, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_KEY = 'inspirquiz_courses_v1';

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

export default function CourseManager() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [courses, setCourses] = useState(() => loadJson(LOCAL_KEY, []));
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [term, setTerm] = useState('');

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/organization/courses`, { headers: { Authorization: `Bearer ${token}` } });
      setCourses(res.data.courses || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load courses.');
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
    saveJson(LOCAL_KEY, courses);
  }, [courses, isAuthed]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/organization/courses`,
          { name: n, code: code.trim() || null, term: term.trim() || null },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setCourses((prev) => [res.data.course, ...prev]);
        setName('');
        setCode('');
        setTerm('');
      } catch (e) {
        console.error(e);
        setError('Failed to create course.');
      }
      return;
    }
    const course = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: n,
      code: code.trim() || null,
      term: term.trim() || null,
      created_at: new Date().toISOString(),
    };
    setCourses((prev) => [course, ...prev].slice(0, 200));
    setName('');
    setCode('');
    setTerm('');
  };

  const remove = async (course) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.delete(`${API_URL}/organization/courses/${course.id}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error(e);
        setError('Failed to delete course.');
        return;
      }
    }
    setCourses((prev) => prev.filter((c) => c.id !== course.id));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Organization</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Course Manager</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Track courses and link assignments and grades to keep everything in one place.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: courses save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Add a course</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Course name (e.g., Biology)"
                  className="md:col-span-2 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Code (optional)"
                  className="px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Term (optional)"
                  className="md:col-span-2 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={create}
                  disabled={!name.trim() || loading}
                  className="px-6 py-3 rounded-lg bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Courses</h2>
                <button
                  onClick={load}
                  disabled={!isAuthed || loading}
                  className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              {courses.length === 0 ? (
                <div className="text-sm text-gray-600">No courses yet.</div>
              ) : (
                <div className="space-y-3">
                  {courses.map((c) => (
                    <div key={c.id} className="border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-extrabold text-gray-900">{c.name}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          {c.code ? `${c.code} • ` : ''}{c.term || '—'}
                        </div>
                      </div>
                      <button
                        onClick={() => remove(c)}
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
                <Link to="/gpa-tracker" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  GPA Tracker
                </Link>
              </div>
              <div className="mt-4 text-sm text-white/80">
                Track coursework and deadlines, then link grade items for a live GPA estimate.
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Pair with</h2>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link to="/study-planner" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Planner
                </Link>
                <Link to="/schedule-builder" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Schedule
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

