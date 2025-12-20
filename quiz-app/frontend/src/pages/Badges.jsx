import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_EARNED_KEY = 'inspirquiz_badges_earned_v1';

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

const DEFAULT_BADGES = [
  { id: 'first-login', name: 'First Login', description: 'Signed in for the first time.', icon: '🔑' },
  { id: 'first-task', name: 'First Task', description: 'Completed your first task.', icon: '✅' },
  { id: 'first-deep-work', name: 'Deep Work Starter', description: 'Completed your first deep work session.', icon: '🧠' },
  { id: 'goal-setter', name: 'Goal Setter', description: 'Set daily goals.', icon: '🎯' },
  { id: 'habit-starter', name: 'Habit Starter', description: 'Created your first habit.', icon: '📅' },
  { id: 'streak-3', name: '3-Day Streak', description: 'Studied 3 days in a row.', icon: '🔥' },
  { id: 'streak-7', name: '7-Day Streak', description: 'Studied 7 days in a row.', icon: '🔥' },
  { id: 'weekly-review', name: 'Weekly Review', description: 'Generated a weekly report.', icon: '📋' },
];

export default function Badges() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');
  const [badges, setBadges] = useState([]);
  const [earned, setEarned] = useState(() => new Set(loadJson(LOCAL_EARNED_KEY, [])));

  useEffect(() => {
    const boot = async () => {
      if (!isAuthed) {
        setBadges(DEFAULT_BADGES.map((b) => ({ ...b, is_earned: earned.has(b.id), earned_at: null })));
        return;
      }
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`${API_URL}/gamification/badges`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setBadges(res.data.badges || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load badges.');
      } finally {
        setLoading(false);
      }
    };
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_EARNED_KEY, Array.from(earned));
  }, [earned, isAuthed]);

  const earnedCount = useMemo(() => badges.filter((b) => b.is_earned).length, [badges]);

  const markEarned = async (badge) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.post(
          `${API_URL}/gamification/badges/award`,
          { badge_id: badge.id },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const res = await axios.get(`${API_URL}/gamification/badges`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setBadges(res.data.badges || []);
      } catch (e) {
        console.error(e);
        setError('Failed to award badge.');
      }
      return;
    }
    setEarned((prev) => new Set([...prev, badge.id]));
    setBadges((prev) => prev.map((b) => (b.id === badge.id ? { ...b, is_earned: true } : b)));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Badges & Achievements</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Small wins, made visible. Collect badges as proof that you’re showing up.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: earned badges save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-sm text-gray-600">Earned</div>
              <div className="text-3xl font-extrabold text-gray-900">{earnedCount} / {badges.length}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/xp-leveling" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                XP & Leveling
              </Link>
              <Link to="/challenges" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                Challenges
              </Link>
            </div>
          </div>
          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
          {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {badges.map((b) => (
            <div key={b.id} className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
              <div className="flex items-center justify-between gap-3">
                <div className="text-4xl">{b.icon || '🏅'}</div>
                <span className={`text-xs px-2 py-1 rounded-full font-bold ${b.is_earned ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {b.is_earned ? 'Earned' : 'Locked'}
                </span>
              </div>
              <div className="mt-3 font-extrabold text-gray-900 text-xl">{b.name}</div>
              <div className="text-sm text-gray-600 mt-1">{b.description}</div>
              <div className="mt-4">
                <button
                  onClick={() => markEarned(b)}
                  disabled={b.is_earned}
                  className="w-full px-4 py-3 rounded-xl font-extrabold transition-all disabled:opacity-50 bg-gray-900 text-white hover:bg-gray-800"
                >
                  {b.is_earned ? 'Collected' : 'Mark earned'}
                </button>
              </div>
              {b.earned_at && (
                <div className="text-xs text-gray-500 mt-3">
                  Earned {new Date(b.earned_at).toLocaleString()}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

