import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_KEY = 'inspirquiz_schedule_blocks_v1';

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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function StudyScheduleBuilder() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');
  const [blocks, setBlocks] = useState(() => loadJson(LOCAL_KEY, []));

  const [day, setDay] = useState(1);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:00');
  const [title, setTitle] = useState('Study block');

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/organization/schedule/blocks`, { headers: { Authorization: `Bearer ${token}` } });
      setBlocks(res.data.blocks || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load schedule.');
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
    saveJson(LOCAL_KEY, blocks);
  }, [blocks, isAuthed]);

  const create = async () => {
    const t = title.trim();
    if (!t || !startTime || !endTime) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/organization/schedule/blocks`,
          { day_of_week: day, start_time: startTime, end_time: endTime, title: t },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setBlocks((prev) => [...prev, res.data.block]);
      } catch (e) {
        console.error(e);
        setError('Failed to add block.');
      }
      return;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      title: t,
      created_at: new Date().toISOString(),
    };
    setBlocks((prev) => [...prev, entry].slice(0, 2000));
  };

  const remove = async (block) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.delete(`${API_URL}/organization/schedule/blocks/${block.id}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error(e);
        setError('Failed to delete block.');
        return;
      }
    }
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
  };

  const grouped = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < 7; i += 1) map.set(i, []);
    for (const b of blocks) {
      const d = Number(b.day_of_week);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(b);
    }
    for (const [k, list] of map) {
      list.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
      map.set(k, list);
    }
    return map;
  }, [blocks]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Organization</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Study Schedule Builder</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Build a weekly schedule with simple repeatable study blocks.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: schedule saves to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Add a block</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Day</label>
                  <select
                    value={day}
                    onChange={(e) => setDay(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
                  >
                    {DAYS.map((d, idx) => (
                      <option key={d} value={idx}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Start</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">End</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
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
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Weekly view</h2>
              <div className="space-y-4">
                {DAYS.map((d, idx) => {
                  const list = grouped.get(idx) || [];
                  return (
                    <div key={d} className="border border-gray-200 rounded-xl p-4">
                      <div className="font-extrabold text-gray-900">{d}</div>
                      {list.length === 0 ? (
                        <div className="text-sm text-gray-600 mt-2">No blocks</div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {list.map((b) => (
                            <div key={b.id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
                              <div>
                                <div className="font-bold text-gray-900">{b.title}</div>
                                <div className="text-xs text-gray-500">{b.start_time} → {b.end_time}</div>
                              </div>
                              <button
                                onClick={() => remove(b)}
                                className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-red-300 transition-all"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Make it work</h2>
              <ul className="space-y-2 text-sm text-white/80">
                <li>• Keep blocks small (45–90 minutes).</li>
                <li>• Leave buffer time between blocks.</li>
                <li>• Protect your best hours.</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/study-timer" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Timer
                </Link>
                <Link to="/break-reminder" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Breaks
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Pair with</h2>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link to="/study-planner" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Planner
                </Link>
                <Link to="/assignment-tracker" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Assignments
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

