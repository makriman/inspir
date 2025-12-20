import { useEffect, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_KEY = 'inspirquiz_milestones_v1';

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

export default function Milestones() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [milestones, setMilestones] = useState(() => loadJson(LOCAL_KEY, []));

  useEffect(() => {
    const boot = async () => {
      if (!isAuthed) return;
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`${API_URL}/gamification/milestones?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMilestones(res.data.milestones || []);
      } catch (e) {
        console.error(e);
        setError('Failed to load milestones.');
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_KEY, milestones);
  }, [milestones, isAuthed]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/gamification/milestones`,
          { milestone_type: 'custom', title: t, metadata: {} },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setMilestones((prev) => [res.data.milestone, ...prev]);
        setTitle('');
      } catch (e) {
        console.error(e);
        setError('Failed to create milestone.');
      }
      return;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      milestone_type: 'custom',
      title: t,
      created_at: new Date().toISOString(),
      metadata: {},
    };
    setMilestones((prev) => [entry, ...prev]);
    setTitle('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Milestone Celebrations</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Capture wins as they happen. Future you will thank you.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: milestones save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Add a milestone</h2>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Finished Chapter 7 revision"
              className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={add}
              disabled={!title.trim() || loading}
              className="px-6 py-3 rounded-lg bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
          {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent milestones</h2>
          {milestones.length === 0 ? (
            <div className="text-sm text-gray-600">No milestones yet.</div>
          ) : (
            <div className="space-y-3">
              {milestones.slice(0, 50).map((m) => (
                <div key={m.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="font-extrabold text-gray-900">{m.title}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {m.created_at ? new Date(m.created_at).toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

