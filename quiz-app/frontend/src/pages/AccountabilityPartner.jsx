import { useEffect, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

export default function AccountabilityPartner() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [partner, setPartner] = useState(null);
  const [partnerUsername, setPartnerUsername] = useState('');
  const [message, setMessage] = useState('');
  const [checkins, setCheckins] = useState([]);

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const [pRes, cRes] = await Promise.all([
        axios.get(`${API_URL}/gamification/accountability/partner`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/gamification/accountability/checkins?limit=50`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setPartner(pRes.data.partner);
      setCheckins(cRes.data.checkins || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load accountability info.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  const setPartnerAction = async () => {
    const u = partnerUsername.trim();
    if (!u) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_URL}/gamification/accountability/partner`,
        { username: u },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPartner(res.data.partner);
      setPartnerUsername('');
      await load();
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || 'Failed to set partner.');
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const m = message.trim();
    if (!m) return;
    setLoading(true);
    setError('');
    try {
      await axios.post(
        `${API_URL}/gamification/accountability/checkins`,
        { message: m },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('');
      await load();
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || 'Failed to send check-in.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">🤝</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Accountability Partner</h1>
          <p className="text-gray-600 mb-6">
            Pair up with a friend, send check-ins, and stay consistent together.
          </p>
          <Link
            to="/auth"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-700 transition-all"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Gamification</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Accountability Partner</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Light structure. Gentle pressure. Better consistency.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Partner</h2>
              {partner ? (
                <div className="flex items-center justify-between flex-wrap gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <div>
                    <div className="text-sm text-gray-600">Current partner</div>
                    <div className="text-xl font-extrabold text-gray-900">@{partner.username}</div>
                  </div>
                  <div className="text-sm text-gray-600">
                    Status: <span className="font-bold text-gray-900">{partner.status}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">No partner set yet.</div>
              )}

              <div className="mt-4 flex flex-col md:flex-row gap-3">
                <input
                  value={partnerUsername}
                  onChange={(e) => setPartnerUsername(e.target.value)}
                  placeholder="Partner username (e.g., alex)"
                  className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={setPartnerAction}
                  disabled={!partnerUsername.trim() || loading}
                  className="px-6 py-3 rounded-lg bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
                >
                  Set partner
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Tip: for now this creates an active partnership immediately (invite/accept can be added later).
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Send a check-in</h2>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="What did you do today? What’s the next action?"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
              <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                <button
                  onClick={send}
                  disabled={!message.trim() || loading}
                  className="px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all disabled:opacity-50"
                >
                  Send
                </button>
                <button
                  onClick={load}
                  disabled={loading}
                  className="px-4 py-3 rounded-xl bg-white border border-gray-200 text-gray-900 font-bold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent check-ins</h2>
              {checkins.length === 0 ? (
                <div className="text-sm text-gray-600">No check-ins yet.</div>
              ) : (
                <div className="space-y-3">
                  {checkins.slice(0, 20).map((c) => (
                    <div key={c.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="font-bold text-gray-900">@{c.from_username}</div>
                        <div className="text-xs text-gray-500">{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</div>
                      </div>
                      {c.message && <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{c.message}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Suggested template</h2>
              <div className="text-sm text-white/80 space-y-2">
                <div>1) Today I did: ____</div>
                <div>2) I got stuck on: ____</div>
                <div>3) Next action: ____</div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/daily-goals" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Daily Goals
                </Link>
                <Link to="/progress-dashboard" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
                  Dashboard
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Status</h2>
              <div className="text-sm text-gray-600">{loading ? 'Working…' : 'Ready.'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

