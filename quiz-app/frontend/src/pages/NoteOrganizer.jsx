import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const LOCAL_NOTES_KEY = 'inspirquiz_organized_notes_v1';

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

function parseTags(input) {
  return input
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

export default function NoteOrganizer() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [error, setError] = useState('');

  const [notes, setNotes] = useState(() => loadJson(LOCAL_NOTES_KEY, []));
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [activeTag, setActiveTag] = useState('');

  const load = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const url = activeTag ? `${API_URL}/organization/notes?tag=${encodeURIComponent(activeTag)}` : `${API_URL}/organization/notes`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      setNotes(res.data.notes || []);
    } catch (e) {
      console.error(e);
      setError('Failed to load notes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, token, activeTag]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_NOTES_KEY, notes);
  }, [notes, isAuthed]);

  const allTags = useMemo(() => {
    const set = new Set();
    for (const n of notes) {
      for (const t of n.tags || []) set.add(String(t).toLowerCase());
    }
    return Array.from(set).sort();
  }, [notes]);

  const visibleNotes = useMemo(() => {
    if (!activeTag) return notes;
    return notes.filter((n) => (n.tags || []).map((t) => String(t).toLowerCase()).includes(activeTag));
  }, [notes, activeTag]);

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    const tags = parseTags(tagsInput);
    setError('');
    if (isAuthed) {
      try {
        const res = await axios.post(
          `${API_URL}/organization/notes`,
          { title: t, content: content.trim() || null, tags },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setNotes((prev) => [res.data.note, ...prev]);
        setTitle('');
        setContent('');
        setTagsInput('');
      } catch (e) {
        console.error(e);
        setError('Failed to create note.');
      }
      return;
    }
    const note = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: t,
      content: content.trim() || null,
      tags,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setNotes((prev) => [note, ...prev].slice(0, 500));
    setTitle('');
    setContent('');
    setTagsInput('');
  };

  const remove = async (note) => {
    setError('');
    if (isAuthed) {
      try {
        await axios.delete(`${API_URL}/organization/notes/${note.id}`, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error(e);
        setError('Failed to delete note.');
        return;
      }
    }
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Organization</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Note Organizer</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Save quick notes and tag them so they’re easy to find later.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: notes save to this device. <Link to="/auth" className="text-purple-700 font-semibold hover:underline">Sign in</Link> to sync.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Create a note</h2>
              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Content (optional)"
                  rows={6}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="Tags (comma-separated) e.g., biology, revision"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={create}
                  disabled={!title.trim() || loading}
                  className="px-6 py-3 rounded-xl bg-purple-600 text-white font-extrabold hover:bg-purple-700 transition-all disabled:opacity-50"
                >
                  Save note
                </button>
              </div>
              {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
              {loading && <div className="mt-4 text-sm text-gray-500">Loading…</div>}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Notes</h2>
                <button
                  onClick={load}
                  disabled={loading || !isAuthed}
                  className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-purple-300 transition-all disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              {visibleNotes.length === 0 ? (
                <div className="text-sm text-gray-600">No notes yet.</div>
              ) : (
                <div className="space-y-4">
                  {visibleNotes.slice(0, 50).map((n) => (
                    <div key={n.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="font-extrabold text-gray-900">{n.title}</div>
                          {n.content && <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{n.content}</div>}
                          <div className="flex flex-wrap gap-2 mt-3">
                            {(n.tags || []).map((t) => (
                              <button
                                key={t}
                                onClick={() => setActiveTag(String(t).toLowerCase())}
                                className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700 font-bold hover:bg-purple-200 transition-all"
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => remove(n)}
                          className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 font-semibold hover:border-red-300 transition-all"
                        >
                          Delete
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        {n.updated_at ? `Updated ${new Date(n.updated_at).toLocaleString()}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-3">Tags</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveTag('')}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    !activeTag ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300'
                  }`}
                >
                  All
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTag(t)}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                      activeTag === t ? 'bg-purple-600 text-white border-purple-600' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="text-xs text-gray-500 mt-3">
                Tip: tag consistently (e.g., “biology”, “chemistry”, “exam-1”) to make search effortless.
              </div>
            </div>

            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 text-white">
              <h2 className="text-xl font-bold mb-3">Pair with</h2>
              <div className="flex flex-wrap gap-2">
                <Link to="/study-planner" className="px-3 py-2 rounded-lg bg-white text-gray-900 font-semibold hover:bg-white/90 transition-all">
                  Study Planner
                </Link>
                <Link to="/course-manager" className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-white font-semibold hover:bg-white/15 transition-all">
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

