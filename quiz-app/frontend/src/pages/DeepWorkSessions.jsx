import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const LOCAL_SESSIONS_KEY = 'inspirquiz_deep_work_sessions_v1';

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

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function DeepWorkSessions() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [history, setHistory] = useState(() => loadJson(LOCAL_SESSIONS_KEY, []));

  const [title, setTitle] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(50);
  const [breakMinutes, setBreakMinutes] = useState(10);
  const [cycles, setCycles] = useState(2);

  const [run, setRun] = useState(null); // {sessionId?, phase, cycleIndex, secondsLeft, startedAt}
  const intervalRef = useRef(null);

  const totalPlannedSeconds = useMemo(() => {
    const focus = Math.max(1, Number(focusMinutes) || 50) * 60;
    const rest = Math.max(1, Number(breakMinutes) || 10) * 60;
    const planned = Math.max(1, Number(cycles) || 1);
    return planned * focus + Math.max(0, planned - 1) * rest;
  }, [focusMinutes, breakMinutes, cycles]);

  useEffect(() => {
    if (!isAuthed) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API_URL}/productivity/deep-work/sessions?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setHistory(res.data.sessions || []);
      } catch (error) {
        console.error('Failed to load deep work sessions:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthed, token]);

  useEffect(() => {
    if (!isAuthed) saveJson(LOCAL_SESSIONS_KEY, history);
  }, [history, isAuthed]);

  useEffect(() => {
    if (!run) {
      clearInterval(intervalRef.current);
      return undefined;
    }
    intervalRef.current = setInterval(() => {
      setRun((prev) => {
        if (!prev) return prev;
        return { ...prev, secondsLeft: Math.max(0, prev.secondsLeft - 1) };
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [run]);

  useEffect(() => {
    if (!run) return;
    if (run.secondsLeft > 0) return;

    const focusSeconds = Math.max(1, Number(focusMinutes) || 50) * 60;
    const breakSeconds = Math.max(1, Number(breakMinutes) || 10) * 60;
    const planned = Math.max(1, Number(cycles) || 1);

    if (run.phase === 'focus') {
      if (run.cycleIndex + 1 >= planned) {
        finishSession(planned);
        return;
      }
      setRun((prev) => prev && ({ ...prev, phase: 'break', secondsLeft: breakSeconds }));
      return;
    }

    // break -> next focus cycle
    setRun((prev) => prev && ({ ...prev, phase: 'focus', cycleIndex: prev.cycleIndex + 1, secondsLeft: focusSeconds }));
  }, [run, focusMinutes, breakMinutes, cycles]);

  const createSessionIfNeeded = async () => {
    if (!isAuthed) return null;
    const res = await axios.post(
      `${API_URL}/productivity/deep-work/sessions`,
      {
        title: title.trim() || null,
        focus_minutes: focusMinutes,
        break_minutes: breakMinutes,
        planned_cycles: cycles,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data.session;
  };

  const startSession = async () => {
    if (run) return;
    const focusSeconds = Math.max(1, Number(focusMinutes) || 50) * 60;
    const startedAt = new Date().toISOString();
    let created = null;
    try {
      created = await createSessionIfNeeded();
      if (created?.id) {
        await axios.patch(
          `${API_URL}/productivity/deep-work/sessions/${created.id}`,
          { status: 'running', started_at: startedAt, completed_cycles: 0 },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
    } catch (error) {
      console.error('Failed to create deep work session:', error);
    }
    setRun({
      sessionId: created?.id || null,
      phase: 'focus',
      cycleIndex: 0,
      secondsLeft: focusSeconds,
      startedAt,
    });
  };

  const cancelSession = async () => {
    if (!run) return;
    const endedAt = new Date().toISOString();
    if (isAuthed && run.sessionId) {
      try {
        await axios.patch(
          `${API_URL}/productivity/deep-work/sessions/${run.sessionId}`,
          { status: 'canceled', ended_at: endedAt },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
        // ignore
      }
    }
    setRun(null);
  };

  const finishSession = async (completedCycles) => {
    const endedAt = new Date().toISOString();
    if (isAuthed && run?.sessionId) {
      try {
        const res = await axios.patch(
          `${API_URL}/productivity/deep-work/sessions/${run.sessionId}`,
          { status: 'completed', ended_at: endedAt, completed_cycles: completedCycles },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setHistory((prev) => [res.data.session, ...prev.filter((s) => s.id !== res.data.session.id)]);
        try {
          await axios.post(
            `${API_URL}/streaks/activity`,
            { activityType: 'deep-work', timeMinutes: focusMinutes * completedCycles },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch {
          // ignore
        }
      } catch (error) {
        console.error('Failed to finish deep work session:', error);
      }
    } else {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: title.trim() || null,
        focus_minutes: focusMinutes,
        break_minutes: breakMinutes,
        planned_cycles: cycles,
        completed_cycles: completedCycles,
        status: 'completed',
        started_at: run?.startedAt || endedAt,
        ended_at: endedAt,
        created_at: endedAt,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 200));
    }
    setRun(null);
  };

  const progress = useMemo(() => {
    if (!run) return 0;
    const focusSeconds = Math.max(1, Number(focusMinutes) || 50) * 60;
    const breakSeconds = Math.max(1, Number(breakMinutes) || 10) * 60;
    const planned = Math.max(1, Number(cycles) || 1);
    const doneCycles = run.cycleIndex;
    const completedSeconds = doneCycles * (focusSeconds + breakSeconds) + (run.phase === 'break' ? focusSeconds : 0) + (run.phase === 'focus' ? focusSeconds - run.secondsLeft : breakSeconds - run.secondsLeft);
    return Math.min(100, Math.max(0, Math.round((completedSeconds / totalPlannedSeconds) * 100)));
  }, [run, focusMinutes, breakMinutes, cycles, totalPlannedSeconds]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Deep Work Sessions</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Structured, multi-cycle sessions for real progress. Less context switching, more output.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: sessions save to this device. Sign in to sync and track in analytics.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Session setup</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Title (optional)</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Final revision sprint"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                    disabled={Boolean(run)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Focus (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={focusMinutes}
                    onChange={(e) => setFocusMinutes(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                    disabled={Boolean(run)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Break (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                    disabled={Boolean(run)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Cycles</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={cycles}
                    onChange={(e) => setCycles(Number(e.target.value))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none"
                    disabled={Boolean(run)}
                  />
                </div>

                <div className="flex items-end">
                  {!run ? (
                    <button
                      onClick={startSession}
                      className="w-full py-3 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 shadow-md transition-all"
                      disabled={loading}
                    >
                      Start deep work
                    </button>
                  ) : (
                    <button
                      onClick={cancelSession}
                      className="w-full py-3 rounded-lg font-semibold bg-white border border-gray-200 hover:border-red-300 text-red-600 transition-all"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gray-950 rounded-2xl shadow-xl p-6 md:p-8 text-white">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                <div>
                  <div className="text-sm text-white/70">Now</div>
                  <div className="text-2xl font-extrabold">
                    {run ? (run.phase === 'focus' ? `Focus • Cycle ${run.cycleIndex + 1}/${cycles}` : 'Break') : 'Not running'}
                  </div>
                </div>
                <div className="text-5xl font-mono">{run ? formatSeconds(run.secondsLeft) : '--:--'}</div>
              </div>

              <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-400 to-pink-500 h-3" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-3 text-sm text-white/70">{progress}% complete</div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Recent sessions</h2>
              {loading && <div className="text-sm text-gray-500">Loading…</div>}
              {!loading && history.length === 0 ? (
                <div className="text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-4">
                  No deep work sessions yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {history.slice(0, 10).map((s) => (
                    <div key={s.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="font-semibold text-gray-900">{s.title || 'Deep work session'}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {s.focus_minutes}m focus • {s.break_minutes}m break • {s.completed_cycles}/{s.planned_cycles} cycles
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        {s.status} • {new Date(s.created_at || Date.now()).toLocaleString()}
                      </div>
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

