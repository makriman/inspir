import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_CHALLENGES_KEY = 'inspirquiz_challenges_v1';
const LOCAL_PROGRESS_KEY = 'inspirquiz_challenges_progress_v1';

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

export default function Challenges() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [targetCount, setTargetCount] = useState(5);

  const [challenges, setChallenges] = useState(() => loadJson(LOCAL_CHALLENGES_KEY, [
    { id: 'local-1', title: 'Complete 5 tasks', description: 'Use Task Timer and complete 5 tasks.', target_count: 5, created_at: new Date().toISOString(), progress: { progress_count: 0, completed_at: null } },
    { id: 'local-2', title: '2 deep work cycles', description: 'Do 2 deep work cycles today.', target_count: 2, created_at: new Date().toISOString(), progress: { progress_count: 0, completed_at: null } },
  ]));

  const [progress, setProgress] = useState(() => loadJson(LOCAL_PROGRESS_KEY, {}));

  useEffect(() => {
    const boot = async () => {
      if (!isAuthed) return;
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`${API_URL}/gamification/challenges`, { headers: { Authorization: `Bearer ${token}` } });
        setChallenges(res.data.challenges || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load challenges.');
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_CHALLENGES_KEY, challenges);
  }, [challenges, isAuthed]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_PROGRESS_KEY, progress);
  }, [progress, isAuthed]);

  const mergedChallenges = useMemo(() => {
    if (isAuthed) return challenges;
    return challenges.map((c) => {
      const p = progress[c.id] || c.progress || { progress_count: 0, completed_at: null };
      const completed = Boolean(p.completed_at) || (p.progress_count || 0) >= (c.target_count || 1);
      return { ...c, progress: { ...p, completed_at: completed ? (p.completed_at || new Date().toISOString()) : null } };
    });
  }, [challenges, progress, isAuthed]);

  const createChallenge = async () => {
    const t = title.trim();
    if (!t) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/gamification/challenges`,
          { title: t, target_count: targetCount },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setChallenges((prev) => [res.data.challenge, ...prev]);
        setTitle('');
      } catch (e) {
        console.error(e);
        setError('Failed to create challenge.');
      }
      return;
    }
    const c = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: t,
      description: null,
      target_count: targetCount,
      created_at: new Date().toISOString(),
      progress: { progress_count: 0, completed_at: null },
    };
    setChallenges((prev) => [c, ...prev]);
    setTitle('');
  };

  const increment = async (challenge) => {
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/gamification/challenges/${challenge.id}/progress`,
          { delta: 1 },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setChallenges((prev) =>
          prev.map((c) =>
            c.id === challenge.id ? { ...c, progress: res.data.progress } : c
          )
        );
      } catch (e) {
        console.error(e);
        setError('Failed to update progress.');
      }
      return;
    }
    setProgress((prev) => {
      const existing = prev[challenge.id] || { progress_count: 0, completed_at: null };
      const nextCount = (existing.progress_count || 0) + 1;
      const completed = nextCount >= (challenge.target_count || 1);
      return {
        ...prev,
        [challenge.id]: { progress_count: nextCount, completed_at: completed ? existing.completed_at || new Date().toISOString() : null },
      };
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Study Challenges</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Create small, measurable challenges. Finish them. Repeat.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: challenges save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Create a challenge</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Finish 3 quizzes"
                  className="md:col-span-2 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={targetCount}
                    onChange={(e) => setTargetCount(Number(e.target.value))}
                    className="w-24 px-3 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={createChallenge}
                    disabled={!title.trim()}
                    className="flex-1 px-4 py-3 rounded-lg bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Your challenges</h2>
              {mergedChallenges.length === 0 ? (
                <div className="text-sm text-gray-600">No challenges yet.</div>
              ) : (
                <div className="space-y-4">
                  {mergedChallenges.map((c) => {
                    const done = c.progress?.progress_count || 0;
                    const target = c.target_count || 1;
                    const pct = Math.min(100, Math.round((done / target) * 100));
                    const complete = Boolean(c.progress?.completed_at) || done >= target;
                    return (
                      <div key={c.id} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <div className="font-extrabold text-gray-900">{c.title}</div>
                            {c.description && <div className="text-sm text-gray-600 mt-1">{c.description}</div>}
                            <div className="text-xs text-gray-500 mt-2">
                              {done} / {target} {complete ? '• completed' : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => increment(c)}
                            disabled={complete}
                            className={`px-4 py-2 rounded-lg font-bold transition-all disabled:opacity-50 ${
                              complete ? 'bg-green-100 text-green-700' : 'bg-gray-900 text-white hover:bg-gray-800'
                            }`}
                          >
                            {complete ? 'Done' : '+1'}
                          </button>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-3">
                          <div className="h-2 bg-purple-600 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Suggested</h2>
              <ul className="space-y-2 text-sm text-white/80">
                <li>• 2 deep work cycles</li>
                <li>• 3 quizzes reviewed</li>
                <li>• 5 tasks completed</li>
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
              <h2 className="text-xl font-bold text-gray-900 mb-2">Rewards</h2>
              <div className="text-sm text-gray-600">
                Completing challenges is a great time to award XP and collect badges.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/xp-leveling" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                  XP
                </Link>
                <Link to="/badges" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                  Badges
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

