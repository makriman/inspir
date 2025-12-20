import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_XP_KEY = 'inspirquiz_xp_v1';
const LOCAL_XP_EVENTS_KEY = 'inspirquiz_xp_events_v1';

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

function computeLevel(totalXp) {
  const xp = Math.max(0, Number.parseInt(totalXp, 10) || 0);
  const level = Math.floor(xp / 100) + 1;
  const base = (level - 1) * 100;
  const next = level * 100;
  return { level, base, next };
}

export default function XpLeveling() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [totalXp, setTotalXp] = useState(() => loadJson(LOCAL_XP_KEY, 0));
  const [events, setEvents] = useState(() => loadJson(LOCAL_XP_EVENTS_KEY, []));

  useEffect(() => {
    const boot = async () => {
      if (!isAuthed) return;
      setLoading(true);
      setError('');
      try {
        const [xpRes, eventsRes] = await Promise.all([
          axios.get(`${API_URL}/gamification/xp`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_URL}/gamification/xp/events?limit=50`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setTotalXp(xpRes.data.xp?.total_xp || 0);
        setEvents(eventsRes.data.events || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load XP.');
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_XP_KEY, totalXp);
  }, [totalXp, isAuthed]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_XP_EVENTS_KEY, events);
  }, [events, isAuthed]);

  const levelInfo = useMemo(() => computeLevel(totalXp), [totalXp]);
  const progressPct = useMemo(() => {
    const denom = Math.max(1, levelInfo.next - levelInfo.base);
    return Math.min(100, Math.max(0, Math.round(((totalXp - levelInfo.base) / denom) * 100)));
  }, [totalXp, levelInfo]);

  const award = async (delta, reason) => {
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/gamification/xp/award`,
          { delta, reason },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setTotalXp(res.data.xp?.total_xp || totalXp);
        const eventsRes = await axios.get(`${API_URL}/gamification/xp/events?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setEvents(eventsRes.data.events || []);
      } catch (e) {
        console.error(e);
        setError('Failed to award XP.');
      }
      return;
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      delta,
      reason,
      created_at: new Date().toISOString(),
    };
    setTotalXp((x) => Math.max(0, x + delta));
    setEvents((prev) => [entry, ...prev].slice(0, 200));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">XP & Leveling</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Turn consistency into momentum. Earn XP for the work you actually do.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: XP is saved on this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="text-sm text-gray-600">Level</div>
                  <div className="text-4xl font-extrabold text-gray-900">{levelInfo.level}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600">Total XP</div>
                  <div className="text-3xl font-extrabold text-gray-900">{totalXp}</div>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span>Progress to next level</span>
                  <span>
                    {Math.max(0, totalXp - levelInfo.base)} / {levelInfo.next - levelInfo.base}
                  </span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-3 bg-purple-600 rounded-full" style={{ width: `${progressPct}%` }} />
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { delta: 5, label: '+5 XP', reason: 'Quick win' },
                  { delta: 15, label: '+15 XP', reason: 'Focused session' },
                  { delta: 30, label: '+30 XP', reason: 'Deep work block' },
                ].map((b) => (
                  <button
                    key={b.label}
                    onClick={() => award(b.delta, b.reason)}
                    disabled={loading}
                    className="px-4 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all disabled:opacity-50"
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent XP</h2>
              {events.length === 0 ? (
                <div className="text-sm text-gray-600">No XP events yet. Award some above to get started.</div>
              ) : (
                <div className="space-y-3">
                  {events.slice(0, 20).map((e) => (
                    <div key={e.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl p-4">
                      <div>
                        <div className="font-bold text-gray-900">{e.reason || 'XP earned'}</div>
                        <div className="text-xs text-gray-500">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</div>
                      </div>
                      <div className="font-extrabold text-purple-700">
                        {e.delta > 0 ? `+${e.delta}` : e.delta}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">What counts?</h2>
              <ul className="space-y-2 text-sm text-white/80">
                <li>• Completing tasks</li>
                <li>• Deep work cycles</li>
                <li>• Daily goals</li>
                <li>• Weekly reviews</li>
              </ul>
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
              <h2 className="text-xl font-bold text-gray-900 mb-2">Next</h2>
              <div className="text-sm text-gray-600">
                Collect badges and climb the leaderboard.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/badges" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  Badges
                </Link>
                <Link to="/leaderboards" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Leaderboards
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

