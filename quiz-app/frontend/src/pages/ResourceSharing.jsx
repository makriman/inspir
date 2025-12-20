import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

function parseTags(input) {
  return input
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

export default function ResourceSharing() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('');

  const [resources, setResources] = useState([]);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const [groupsRes, resourcesRes] = await Promise.all([
        axios.get(`${API_URL}/social/groups`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/social/resources${groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setGroups(groupsRes.data.groups || []);
      setResources(resourcesRes.data.resources || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load resources.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token, groupId]);

  const create = async () => {
    const t = title.trim();
    const u = url.trim();
    if (!t || !u) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(
        `${API_URL}/social/resources`,
        {
          title: t,
          url: u,
          description: description.trim() || null,
          tags: parseTags(tagsInput),
          group_id: groupId || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setResources((prev) => [res.data.resource, ...prev]);
      setTitle('');
      setUrl('');
      setDescription('');
      setTagsInput('');
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.error || 'Failed to create resource.');
    } finally {
      setLoading(false);
    }
  };

  const groupLabel = useMemo(() => {
    if (!groupId) return 'All (personal + global)';
    const g = groups.find((x) => x.id === groupId);
    return g ? g.name : 'Selected group';
  }, [groupId, groups]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-10 px-4">
        <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Resource Sharing</h1>
          <p className="text-gray-600 mb-6">
            Share useful links and resources with your study groups.
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
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Resource Sharing</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Share the best explanations, videos, and docs with your group — in one organized feed.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Filter</h2>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Group</label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
              >
                <option value="">All</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <div className="text-xs text-gray-500 mt-2">Current: {groupLabel}</div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={load}
                  disabled={loading}
                  className="flex-1 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
                <Link
                  to="/study-groups"
                  className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all text-center"
                >
                  Groups
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Share a resource</h2>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                placeholder="Title"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-3 w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                placeholder="https://..."
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-3 w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                placeholder="Description (optional)"
              />
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="mt-3 w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                placeholder="Tags (comma-separated)"
              />
              <button
                onClick={create}
                disabled={!title.trim() || !url.trim() || loading}
                className="mt-3 w-full px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all disabled:opacity-50"
              >
                Share
              </button>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Working…</div>}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Feed</h2>
              {resources.length === 0 ? (
                <div className="text-sm text-gray-600">No resources yet.</div>
              ) : (
                <div className="space-y-4">
                  {resources.slice(0, 100).map((r) => (
                    <div key={r.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-extrabold text-gray-900">{r.title}</div>
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-sm text-purple-700 font-semibold hover:underline break-all">
                            {r.url}
                          </a>
                          {r.description && <div className="text-sm text-gray-700 mt-2">{r.description}</div>}
                          <div className="flex flex-wrap gap-2 mt-3">
                            {(r.tags || []).map((t) => (
                              <span key={t} className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700 font-bold">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                        </div>
                      </div>
                      {r.username && <div className="text-xs text-gray-500 mt-2">Shared by @{r.username}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

