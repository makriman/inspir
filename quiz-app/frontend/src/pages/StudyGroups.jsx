import { useEffect, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

export default function StudyGroups() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedDetails, setSelectedDetails] = useState(null);

  const [name, setName] = useState('Study Group');
  const [description, setDescription] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const loadGroups = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/social/groups`, { headers: { Authorization: `Bearer ${token}` } });
      setGroups(res.data.groups || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load groups.');
    } finally {
      setLoading(false);
    }
  };

  const loadGroup = async (groupId) => {
    if (!isAuthed || !groupId) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/social/groups/${groupId}`, { headers: { Authorization: `Bearer ${token}` } });
      setSelectedDetails(res.data);
    } catch (e) {
      console.error(e);
      setError('Failed to load group details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token]);

  useEffect(() => {
    if (!selected) return;
    loadGroup(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_URL}/social/groups`,
        { name: n, description: description.trim() || null, is_private: false },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGroups((prev) => [res.data.group, ...prev]);
      setSelected(res.data.group);
      setDescription('');
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || 'Failed to create group.');
    } finally {
      setLoading(false);
    }
  };

  const join = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/social/groups/join/${code}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setGroups((prev) => [res.data.group, ...prev.filter((g) => g.id !== res.data.group.id)]);
      setSelected(res.data.group);
      setJoinCode('');
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || 'Failed to join group.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">👥</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Study Groups</h1>
          <p className="text-gray-600 mb-6">
            Create a group, share a join code, and share resources with your friends.
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
            <span className="text-purple-700 font-semibold text-sm">Social</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Study Groups</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Lightweight groups to coordinate and share study resources (real-time chat can come later).
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Create</h2>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                placeholder="Group name"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-3 w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                placeholder="Description (optional)"
              />
              <button
                onClick={create}
                disabled={!name.trim() || loading}
                className="mt-3 w-full px-6 py-3 rounded-xl bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
              >
                Create group
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Join</h2>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none font-mono tracking-widest"
                placeholder="ABC123"
              />
              <button
                onClick={join}
                disabled={!joinCode.trim() || loading}
                className="mt-3 w-full px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all disabled:opacity-50"
              >
                Join group
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-gray-900">Your groups</h2>
                <button
                  onClick={loadGroups}
                  disabled={loading}
                  className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {groups.length === 0 && <div className="text-sm text-gray-600">No groups yet.</div>}
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelected(g)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                      selected?.id === g.id ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:border-purple-300'
                    }`}
                  >
                    <div className="font-extrabold text-gray-900">{g.name}</div>
                    <div className="text-xs text-gray-500 mt-1">Join code: <span className="font-mono">{g.join_code}</span></div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-2xl font-bold text-gray-900">Group</h2>
                <div className="flex flex-wrap gap-2">
                  <Link to="/resource-sharing" className="px-3 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all">
                    Share resources
                  </Link>
                  <Link to="/group-timer" className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all">
                    Group Timer
                  </Link>
                </div>
              </div>

              {!selected ? (
                <div className="mt-4 text-sm text-gray-600">Select a group on the left.</div>
              ) : (
                <div className="mt-4">
                  <div className="font-extrabold text-gray-900 text-2xl">{selected.name}</div>
                  {selected.description && <div className="text-sm text-gray-600 mt-2">{selected.description}</div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-bold">
                      Code: <span className="font-mono">{selected.join_code}</span>
                    </span>
                    <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-bold">
                      Role: {selected.my_role || 'member'}
                    </span>
                    {selectedDetails?.memberCount !== undefined && (
                      <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-bold">
                        Members: {selectedDetails.memberCount}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => loadGroup(selected.id)}
                    disabled={loading}
                    className="mt-4 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all disabled:opacity-50"
                  >
                    Refresh details
                  </button>
                </div>
              )}

              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Working…</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

