import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const SESSIONS_KEY = 'inspirquiz_study_sessions_v1';

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSessions(sessions) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

function downloadJson(filename, json) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  const header = ['id', 'username', 'subject', 'mode', 'durationSeconds', 'startedAt', 'endedAt'];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    header.join(','),
    ...rows.map((row) => header.map((key) => escape(row[key])).join(',')),
  ];
  return lines.join('\n');
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StudySessionTracker() {
  const { user } = useAuth();
  const username = user?.username || 'Guest';

  const [sessions, setSessions] = useState(() => loadSessions());
  const [onlyMine, setOnlyMine] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('all');

  const subjects = useMemo(() => {
    const set = new Set(sessions.map((s) => s.subject).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const filtered = useMemo(() => {
    const subjectNeedle = subjectFilter.trim().toLowerCase();
    return sessions.filter((s) => {
      if (onlyMine && s.username !== username) return false;
      if (modeFilter !== 'all' && s.mode !== modeFilter) return false;
      if (subjectNeedle && !String(s.subject || '').toLowerCase().includes(subjectNeedle)) return false;
      return true;
    });
  }, [sessions, onlyMine, username, subjectFilter, modeFilter]);

  const totals = useMemo(() => {
    const focus = filtered.filter((s) => s.mode === 'focus').reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
    const all = filtered.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
    return {
      totalMinutes: Math.round(all / 60),
      focusMinutes: Math.round(focus / 60),
      count: filtered.length,
    };
  }, [filtered]);

  const clearSessions = () => {
    const keep = onlyMine ? sessions.filter((s) => s.username !== username) : [];
    setSessions(keep);
    persistSessions(keep);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Study Session Tracker</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Review and export your Study Timer sessions. Sessions are stored locally on this device.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-semibold text-gray-700 mb-2">View</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                  Only my sessions ({username})
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Mode</label>
              <select
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
              >
                <option value="all">All</option>
                <option value="focus">Focus</option>
                <option value="break">Break</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Subject filter</label>
              <input
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                list="subjects"
                placeholder="e.g., Biology"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
              />
              <datalist id="subjects">
                {subjects.map((s) => (
                  <option value={s} key={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm text-gray-600">Sessions</div>
              <div className="text-2xl font-bold text-gray-900">{totals.count}</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm text-gray-600">Focus minutes</div>
              <div className="text-2xl font-bold text-gray-900">{totals.focusMinutes}</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm text-gray-600">Total minutes</div>
              <div className="text-2xl font-bold text-gray-900">{totals.totalMinutes}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              onClick={() => downloadJson('study_sessions.json', filtered)}
              className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all"
            >
              Export JSON
            </button>
            <button
              onClick={() => downloadText('study_sessions.csv', toCsv(filtered))}
              className="px-4 py-2 rounded-lg font-semibold bg-white border border-gray-200 hover:border-purple-300 text-gray-700 transition-all"
            >
              Export CSV
            </button>
            <button
              onClick={clearSessions}
              className="px-4 py-2 rounded-lg font-semibold bg-white border border-gray-200 hover:border-red-300 text-red-600 transition-all"
            >
              {onlyMine ? 'Clear my sessions' : 'Clear all sessions'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Sessions</h2>

          {filtered.length === 0 ? (
            <div className="text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-6">
              No sessions match your filters yet. Start one in the Study Timer or Focus Mode.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.slice(0, 100).map((s) => (
                <div key={s.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-gray-900">
                      {s.subject || 'General Study'} <span className="text-gray-500">• {s.mode}</span>
                    </div>
                    <div className="text-sm text-gray-600">{Math.round((s.durationSeconds || 0) / 60)} min</div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {s.username || 'Guest'} • {new Date(s.startedAt).toLocaleString()}
                  </div>
                </div>
              ))}
              {filtered.length > 100 && (
                <div className="text-sm text-gray-500">Showing first 100 sessions (export to view all).</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

