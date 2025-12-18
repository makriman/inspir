import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import Navigation from '../components/Navigation';

const API_URL = import.meta.env.VITE_API_URL;

export default function CornellNotes() {
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [generatedNotes, setGeneratedNotes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notesHistory, setNotesHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load notes history if user is authenticated
  useEffect(() => {
    if (user && showHistory) {
      loadHistory();
    }
  }, [user, showHistory]);

  const loadHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/cornell-notes/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotesHistory(response.data.notes || []);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const generateNotes = async () => {
    if (content.trim().length < 50) {
      setError('Please provide at least 50 characters of content to generate notes');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const response = await axios.post(
        `${API_URL}/cornell-notes/generate`,
        {
          title: title || 'Untitled Notes',
          subject,
          content
        },
        { headers }
      );

      setGeneratedNotes(response.data);
      if (user && showHistory) {
        loadHistory();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate Cornell notes');
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = async (id) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/cornell-notes/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadHistory();
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  const exportNotes = () => {
    if (!generatedNotes) return;

    const exportText = `${title || 'Cornell Notes'}\n${'='.repeat(50)}\n\nCUES:\n${generatedNotes.cues.map((cue, i) => `${i + 1}. ${cue}`).join('\n')}\n\nNOTES:\n${generatedNotes.notes.map((note, i) => `${i + 1}. ${note}`).join('\n')}\n\nSUMMARY:\n${generatedNotes.summary}`;

    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'cornell-notes'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-4">
              📝 Cornell Notes Generator
            </h1>
            <p className="text-xl text-gray-300">
              Transform your study materials into structured Cornell notes with AI
            </p>
          </div>

          {/* Main Card */}
          <div className="bg-white rounded-xl shadow-2xl p-8 mb-8">
            {/* Input Section */}
            <div className="mb-6">
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Photosynthesis Overview"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Subject (Optional)
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g., Biology"
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all"
                  />
                </div>
              </div>

              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Content to Convert (minimum 50 characters)
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste your lecture notes, textbook excerpts, or study materials here..."
                rows="10"
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all resize-y"
              />
              <div className="text-sm text-gray-500 mt-1">
                {content.length} characters {content.length < 50 && `(need ${50 - content.length} more)`}
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={generateNotes}
              disabled={loading || content.length < 50}
              className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-4 rounded-lg font-bold text-lg hover:from-purple-700 hover:to-indigo-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Generating Cornell Notes...' : '🧠 Generate Cornell Notes'}
            </button>

            {/* Error Message */}
            {error && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                {error}
              </div>
            )}
          </div>

          {/* Generated Cornell Notes */}
          {generatedNotes && (
            <div className="bg-white rounded-xl shadow-2xl p-8 mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Cornell Notes Format</h2>
                <div className="flex gap-3">
                  <button
                    onClick={exportNotes}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    📥 Export
                  </button>
                  {generatedNotes.saved && (
                    <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-semibold">
                      ✓ Saved
                    </span>
                  )}
                </div>
              </div>

              {/* Cornell Notes Layout */}
              <div className="border-2 border-gray-800 rounded-lg overflow-hidden">
                {/* Header */}
                <div className="bg-gray-100 border-b-2 border-gray-800 p-4">
                  <div className="font-bold text-lg">{title || 'Cornell Notes'}</div>
                  {subject && <div className="text-sm text-gray-600">{subject}</div>}
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date().toLocaleDateString()}
                  </div>
                </div>

                {/* Main Notes Area */}
                <div className="flex">
                  {/* Cues Column (Left) */}
                  <div className="w-1/3 border-r-2 border-gray-800 p-4 bg-purple-50">
                    <h3 className="font-bold text-purple-800 mb-3 text-sm uppercase">
                      Cues / Questions
                    </h3>
                    <ul className="space-y-2">
                      {generatedNotes.cues.map((cue, index) => (
                        <li key={index} className="text-sm text-gray-700">
                          • {cue}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Notes Column (Right) */}
                  <div className="w-2/3 p-4 bg-white">
                    <h3 className="font-bold text-indigo-800 mb-3 text-sm uppercase">
                      Notes
                    </h3>
                    <ul className="space-y-2">
                      {generatedNotes.notes.map((note, index) => (
                        <li key={index} className="text-sm text-gray-700 leading-relaxed">
                          {index + 1}. {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Summary Section (Bottom) */}
                <div className="border-t-2 border-gray-800 p-4 bg-blue-50">
                  <h3 className="font-bold text-blue-800 mb-2 text-sm uppercase">
                    Summary
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {generatedNotes.summary}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Notes History (Authenticated Users) */}
          {user && (
            <div className="bg-white rounded-xl shadow-2xl p-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">📚 Notes Library</h2>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  {showHistory ? 'Hide' : 'Show'} History
                </button>
              </div>

              {showHistory && (
                <div className="space-y-4">
                  {notesHistory.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                      No notes saved yet. Generate your first Cornell notes above!
                    </p>
                  ) : (
                    notesHistory.map(note => (
                      <div key={note.id} className="p-4 border-2 border-gray-200 rounded-lg hover:border-purple-300 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-bold text-gray-800">{note.title}</h3>
                            {note.subject && (
                              <span className="text-sm text-purple-600">{note.subject}</span>
                            )}
                          </div>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            🗑️
                          </button>
                        </div>
                        <div className="text-xs text-gray-400">
                          {new Date(note.created_at).toLocaleDateString()} • {note.cues?.length || 0} cues • {note.notes?.length || 0} notes
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
