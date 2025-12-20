import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_HABITS_KEY = 'inspirquiz_habits_v1';
const LOCAL_CHECKINS_KEY = 'inspirquiz_habit_checkins_v1';

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().split('T')[0];
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

export default function HabitTracker() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [newHabitName, setNewHabitName] = useState('');
  const [habits, setHabits] = useState(() => loadJson(LOCAL_HABITS_KEY, []));
  const [checkins, setCheckins] = useState(() => loadJson(LOCAL_CHECKINS_KEY, []));
  const [includeArchived, setIncludeArchived] = useState(false);

  const dateTo = todayDate();
  const dateFrom = addDays(dateTo, -13);

  useEffect(() => {
    const boot = async () => {
      if (!isAuthed) return;
      setLoading(true);
      setError('');
      try {
        const [habitsRes, checkinsRes] = await Promise.all([
          axios.get(`${API_URL}/goals/habits?includeArchived=${includeArchived ? 'true' : 'false'}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get(`${API_URL}/goals/habits/checkins?from=${dateFrom}&to=${dateTo}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        setHabits(habitsRes.data.habits || []);
        setCheckins(checkinsRes.data.checkins || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load habits. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [isAuthed, token, includeArchived, dateFrom, dateTo]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_HABITS_KEY, habits);
  }, [habits, isAuthed]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_CHECKINS_KEY, checkins);
  }, [checkins, isAuthed]);

  const days = useMemo(() => {
    const out = [];
    for (let i = 0; i < 14; i += 1) out.push(addDays(dateFrom, i));
    return out;
  }, [dateFrom]);

  const checkinMap = useMemo(() => {
    const map = new Map();
    for (const c of checkins) {
      map.set(`${c.habit_id}|${c.checkin_date}`, Boolean(c.done));
    }
    return map;
  }, [checkins]);

  const toggleCheckin = async (habitId, date) => {
    setError('');
    const key = `${habitId}|${date}`;
    const current = Boolean(checkinMap.get(key));
    const nextDone = !current;

    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/goals/habits/${habitId}/checkin`,
          { checkin_date: date, done: nextDone },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const saved = res.data.checkin;
        setCheckins((prev) => {
          const filtered = prev.filter((c) => !(c.habit_id === habitId && c.checkin_date === date));
          return [saved, ...filtered];
        });
      } catch (e) {
        console.error(e);
        setError('Failed to save check-in.');
      }
      return;
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      habit_id: habitId,
      checkin_date: date,
      done: nextDone,
      created_at: new Date().toISOString(),
    };
    setCheckins((prev) => {
      const filtered = prev.filter((c) => !(c.habit_id === habitId && c.checkin_date === date));
      return [entry, ...filtered].slice(0, 5000);
    });
  };

  const createHabit = async () => {
    const name = newHabitName.trim();
    if (!name) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/goals/habits`,
          { name },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setHabits((prev) => [...prev, res.data.habit]);
        setNewHabitName('');
      } catch (e) {
        console.error(e);
        setError('Failed to create habit.');
      }
      return;
    }

    const habit = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      is_archived: false,
      created_at: new Date().toISOString(),
    };
    setHabits((prev) => [...prev, habit]);
    setNewHabitName('');
  };

  const setArchived = async (habit, isArchived) => {
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.patch(
          `${API_URL}/goals/habits/${habit.id}`,
          { is_archived: isArchived },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setHabits((prev) => prev.map((h) => (h.id === habit.id ? res.data.habit : h)));
      } catch (e) {
        console.error(e);
        setError('Failed to update habit.');
      }
      return;
    }
    setHabits((prev) => prev.map((h) => (h.id === habit.id ? { ...h, is_archived: isArchived } : h)));
  };

  const visibleHabits = useMemo(() => {
    if (includeArchived) return habits;
    return habits.filter((h) => !h.is_archived);
  }, [habits, includeArchived]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Habit Tracker</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Turn consistency into a system. Track small habits daily and watch the streaks stack up.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: habits save to this device only.{' '}
              <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Your habits</h2>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeArchived}
                    onChange={(e) => setIncludeArchived(e.target.checked)}
                  />
                  Show archived
                </label>
              </div>

              <div className="flex flex-col md:flex-row gap-3">
                <input
                  value={newHabitName}
                  onChange={(e) => setNewHabitName(e.target.value)}
                  placeholder="Add a habit (e.g., 20 min revision)"
                  className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={createHabit}
                  disabled={!newHabitName.trim()}
                  className="px-6 py-3 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              <div className="mt-6 space-y-4">
                {visibleHabits.length === 0 && (
                  <div className="text-sm text-gray-600">No habits yet. Add one above to get started.</div>
                )}

                {visibleHabits.map((habit) => {
                  const todayKey = `${habit.id}|${dateTo}`;
                  const doneToday = Boolean(checkinMap.get(todayKey));
                  return (
                    <div key={habit.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="font-bold text-gray-900">{habit.name}</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleCheckin(habit.id, dateTo)}
                            className={`px-3 py-2 rounded-lg font-semibold transition-all ${
                              doneToday
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-white border border-gray-200 text-gray-900 hover:border-purple-300'
                            }`}
                          >
                            {doneToday ? 'Done today' : 'Mark done'}
                          </button>
                          <button
                            onClick={() => setArchived(habit, !habit.is_archived)}
                            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-50 border border-gray-200 text-gray-700 hover:border-purple-300 transition-all"
                          >
                            {habit.is_archived ? 'Unarchive' : 'Archive'}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-1 overflow-x-auto">
                        {days.map((d) => {
                          const done = Boolean(checkinMap.get(`${habit.id}|${d}`));
                          const isToday = d === dateTo;
                          return (
                            <button
                              key={d}
                              onClick={() => toggleCheckin(habit.id, d)}
                              title={`${d}${done ? ' — done' : ''}`}
                              className={`w-7 h-7 rounded-md border transition-all ${
                                done ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-200'
                              } ${isToday ? 'ring-2 ring-purple-300' : ''}`}
                            />
                          );
                        })}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Click a square to toggle that day. Showing last 14 days.
                      </div>
                    </div>
                  );
                })}
              </div>

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Simple rules</h2>
              <ul className="space-y-2 text-sm text-white/80">
                <li>• Start with one habit.</li>
                <li>• Make it tiny. Make it daily.</li>
                <li>• Don’t miss twice — get back on track the next day.</li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/daily-goals" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Daily Goals
                </Link>
                <Link to="/streaks" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Study Streaks
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Status</h2>
              <div className="text-sm text-gray-600">
                {loading ? 'Loading…' : 'Ready.'}
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Check-ins sync to your account when signed in.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

