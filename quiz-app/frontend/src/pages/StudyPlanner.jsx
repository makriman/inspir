import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_EVENTS_KEY = 'inspirquiz_planner_events_v1';

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

export default function StudyPlanner() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [events, setEvents] = useState(() => loadJson(LOCAL_EVENTS_KEY, []));
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState(isoNowLocalMinute());
  const [endAt, setEndAt] = useState('');
  const [eventType, setEventType] = useState('study');
  const [notes, setNotes] = useState('');

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/organization/planner/events`, { headers: { Authorization: `Bearer ${token}` } });
      setEvents(res.data.events || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load events.');
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
    saveJson(LOCAL_EVENTS_KEY, events);
  }, [events, isAuthed]);

  const create = async () => {
    const t = title.trim();
    if (!t || !startAt) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/organization/planner/events`,
          {
            title: t,
            start_at: new Date(startAt).toISOString(),
            end_at: endAt ? new Date(endAt).toISOString() : null,
            event_type: eventType,
            notes: notes.trim() || null,
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setEvents((prev) => [...prev, res.data.event].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))));
        setTitle('');
        setNotes('');
      } catch (e) {
        console.error(e);
        setError('Failed to create event.');
      }
      return;
    }
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: t,
      start_at: new Date(startAt).toISOString(),
      end_at: endAt ? new Date(endAt).toISOString() : null,
      event_type: eventType,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
    };
    setEvents((prev) => [...prev, event].sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))).slice(0, 1000));
    setTitle('');
    setNotes('');
  };

  const remove = async (event) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.delete(`${API_URL}/organization/planner/events/${event.id}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error(e);
        setError('Failed to delete event.');
        return;
      }
    }
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
  };

  const upcoming = useMemo(() => {
    const now = Date.now();
    return (events || [])
      .filter((e) => new Date(e.start_at).getTime() >= now - 60 * 60 * 1000)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 50);
  }, [events]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Organization</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Study Planner</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Plan your week in simple time blocks — study sessions, exams, deadlines.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: events save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Add an event</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Biology revision"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Start</label>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">End (optional)</label>
                  <input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Type</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
                  >
                    <option value="study">Study</option>
                    <option value="exam">Exam</option>
                    <option value="assignment">Assignment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Optional notes"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 items-center">
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
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Upcoming</h2>
              {upcoming.length === 0 ? (
                <div className="text-sm text-gray-600">No upcoming events yet.</div>
              ) : (
                <div className="space-y-3">
                  {upcoming.map((e) => (
                    <div key={e.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-extrabold text-gray-900">{e.title}</div>
                          <div className="text-sm text-gray-700 mt-1">
                            {new Date(e.start_at).toLocaleString()}
                            {e.end_at ? ` → ${new Date(e.end_at).toLocaleString()}` : ''}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 capitalize">{(e.event_type || 'study').replaceAll('-', ' ')}</div>
                          {e.notes && <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{e.notes}</div>}
                        </div>
                        <button
                          onClick={() => remove(e)}
                          className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-red-300 transition-all"
                        >
                          Delete
                        </button>
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
                <Link to="/assignment-tracker" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Assignments
                </Link>
                <Link to="/schedule-builder" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Schedule Builder
                </Link>
              </div>
              <div className="mt-4 text-sm text-white/80">
                Planning is only useful if it turns into time blocks you actually execute.
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Quick links</h2>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link to="/note-organizer" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Notes
                </Link>
                <Link to="/course-manager" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Courses
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

