import { useEffect, useMemo, useRef, useState } from 'react';
import Navigation from '../components/Navigation';
import { useAuth } from '../contexts/AuthContext';

const STORAGE_KEY = 'inspirquiz_study_sessions_v1';

function loadSessions() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load sessions', err);
    return [];
  }
}

function persistSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error('Failed to save sessions', err);
  }
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function computeAnalytics(sessions, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = sessions.filter((s) => new Date(s.startedAt).getTime() >= cutoff && s.mode === 'focus');

  const totalSeconds = filtered.reduce((sum, s) => sum + s.durationSeconds, 0);
  const bySubject = filtered.reduce((map, s) => {
    const current = map[s.subject] || 0;
    map[s.subject] = current + s.durationSeconds;
    return map;
  }, {});

  const topSubject = Object.entries(bySubject).sort((a, b) => b[1] - a[1])[0];

  return {
    totalMinutes: Math.round(totalSeconds / 60),
    sessionsCount: filtered.length,
    topSubject: topSubject ? { name: topSubject[0], minutes: Math.round(topSubject[1] / 60) } : null,
  };
}

function computeStreaks(sessions) {
  const focusSessions = sessions
    .filter((s) => s.mode === 'focus')
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  if (!focusSessions.length) return { streak: 0, longest: 0 };

  let streak = 1;
  let longest = 1;
  for (let i = 1; i < focusSessions.length; i += 1) {
    const prev = new Date(focusSessions[i - 1].startedAt);
    const current = new Date(focusSessions[i].startedAt);
    const diffDays = Math.floor((prev - current) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      streak += 1;
      longest = Math.max(longest, streak);
    } else if (diffDays > 1) {
      break;
    }
  }
  return { streak, longest };
}

export default function StudyTimer() {
  const { user } = useAuth();
  const username = user?.username || 'Guest';

  const [subject, setSubject] = useState('');
  const [studyMinutes, setStudyMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [mode, setMode] = useState('focus'); // focus | break
  const [secondsLeft, setSecondsLeft] = useState(studyMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState(() => loadSessions());
  const [activeStart, setActiveStart] = useState(null);
  const [activeSubject, setActiveSubject] = useState('');

  const intervalRef = useRef(null);

  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!isRunning) {
      clearInterval(intervalRef.current);
      return undefined;
    }

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  useEffect(() => {
    if (secondsLeft < 0) return;
    if (secondsLeft === 0) {
      completeSession();
    }
  }, [secondsLeft]);

  const weekly = useMemo(() => computeAnalytics(sessions.filter((s) => s.username === username), 7), [sessions, username]);
  const monthly = useMemo(() => computeAnalytics(sessions.filter((s) => s.username === username), 30), [sessions, username]);
  const streaks = useMemo(() => computeStreaks(sessions.filter((s) => s.username === username)), [sessions, username]);

  const leaderboard = useMemo(() => {
    const sample = [
      { username: 'FocusFox', streak: 12 },
      { username: 'StudyStar', streak: 9 },
      { username: 'DeepWorkDan', streak: 7 },
    ];
    const currentEntry = { username, streak: streaks.streak };
    const combined = [...sample, currentEntry]
      .reduce((acc, entry) => {
        const existing = acc.find((item) => item.username === entry.username);
        if (existing) {
          existing.streak = Math.max(existing.streak, entry.streak);
        } else {
          acc.push(entry);
        }
        return acc;
      }, [])
      .sort((a, b) => b.streak - a.streak)
      .slice(0, 10);
    return combined;
  }, [streaks.streak, username]);

  const handleStart = () => {
    const effectiveSubject = subject.trim() || 'General Study';
    setActiveSubject(effectiveSubject);
    setMode('focus');
    setSecondsLeft(studyMinutes * 60);
    setIsRunning(true);
    setActiveStart(new Date().toISOString());
  };

  const togglePause = () => {
    setIsRunning((prev) => !prev);
  };

  const handleSkip = () => {
    completeSession(true);
  };

  const completeSession = (skipped = false) => {
    const now = new Date();
    const duration = activeStart ? Math.max(1, Math.round((now - new Date(activeStart)) / 1000)) : (mode === 'focus' ? studyMinutes : breakMinutes) * 60;

    if (!skipped) {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        username,
        subject: activeSubject || 'General Study',
        durationSeconds: duration,
        mode,
        startedAt: activeStart || now.toISOString(),
        endedAt: now.toISOString(),
      };
      setSessions((prev) => [entry, ...prev].slice(0, 500));
    }

    if (mode === 'focus') {
      setMode('break');
      setSecondsLeft(breakMinutes * 60);
      setActiveStart(new Date().toISOString());
    } else {
      setMode('focus');
      setSecondsLeft(studyMinutes * 60);
      setActiveStart(new Date().toISOString());
    }

    setIsRunning(false);
  };

  const progress =
    mode === 'focus'
      ? 100 - (secondsLeft / (studyMinutes * 60)) * 100
      : 100 - (secondsLeft / (breakMinutes * 60)) * 100;

  const recentSessions = sessions
    .filter((s) => s.username === username)
    .slice(0, 6);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-dark to-purple-darker text-white">
      <Navigation />

      <main className="flex-grow">
        <section className="max-w-6xl mx-auto px-4 py-10">
          <div className="text-center mb-10">
            <p className="uppercase text-sm tracking-widest text-vibrant-yellow mb-2">Deep Work Companion</p>
            <h1 className="text-4xl md:text-5xl font-extrabold mb-4">Pomodoro Study Timer with Analytics</h1>
            <p className="text-lg text-purple-100 max-w-3xl mx-auto">
              Set your focus and break intervals, track subjects, and see weekly/monthly patterns with streak leaderboards to keep you motivated.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white/10 backdrop-blur-lg border border-white/10 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center md:space-x-4 space-y-4 md:space-y-0 mb-6">
                  <div className="flex-1">
                    <label className="text-sm text-purple-100">Subject / Focus Area</label>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g., Biology notes, Calculus practice, Essay drafting"
                      className="w-full mt-2 px-4 py-3 rounded-xl bg-white text-deep-blue placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-vibrant-yellow"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-purple-100">Focus (minutes)</label>
                    <input
                      type="number"
                      min="5"
                      max="120"
                      value={studyMinutes}
                      onChange={(e) => setStudyMinutes(Number(e.target.value) || 25)}
                      className="w-full mt-2 px-4 py-3 rounded-xl bg-white text-deep-blue placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-vibrant-yellow"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-purple-100">Break (minutes)</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(Number(e.target.value) || 5)}
                      className="w-full mt-2 px-4 py-3 rounded-xl bg-white text-deep-blue placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-vibrant-yellow"
                    />
                  </div>
                </div>

                <div className="flex flex-col md:flex-row items-center md:items-end md:space-x-8 space-y-6 md:space-y-0">
                  <div className="relative w-full md:w-64 aspect-square flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-white/10 backdrop-blur" />
                    <div className="absolute inset-2 rounded-full bg-white/10 backdrop-blur" />
                    <div className="absolute inset-4 rounded-full bg-purple-900/60 border border-white/10 flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-sm text-purple-200 uppercase tracking-wide">{mode === 'focus' ? 'Focus' : 'Break'}</p>
                        <p className="text-4xl md:text-5xl font-extrabold mt-1">{formatDuration(Math.max(secondsLeft, 0))}</p>
                        <p className="text-xs text-purple-200 mt-2">{activeSubject || 'Waiting to start'}</p>
                      </div>
                    </div>
                    <svg className="absolute inset-0" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.1)" strokeWidth="6" fill="none" />
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        stroke="#C6FF00"
                        strokeWidth="6"
                        fill="none"
                        strokeDasharray={`${(Math.min(Math.max(progress, 0), 100) / 100) * 2 * Math.PI * 45} ${2 * Math.PI * 45}`}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                    </svg>
                  </div>

                  <div className="flex-1 space-y-3 w-full">
                    <button
                      onClick={handleStart}
                      className="w-full bg-coral-red text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:scale-[1.01] transition-transform disabled:opacity-60"
                    >
                      Start New Focus Session
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={togglePause}
                        className="bg-white/15 border border-white/10 text-white py-3 rounded-xl font-semibold hover:bg-white/20 transition"
                      >
                        {isRunning ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={handleSkip}
                        className="bg-white/10 border border-white/10 text-white py-3 rounded-xl font-semibold hover:bg-white/20 transition"
                      >
                        Skip / End
                      </button>
                    </div>
                    <p className="text-sm text-purple-100">
                      Tip: Start a session to log your time. We automatically switch to a break when focus ends, and back to focus after break.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-lg border border-white/10 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">Recent Sessions</h2>
                  <span className="text-sm text-purple-200">{recentSessions.length} logged</span>
                </div>
                {recentSessions.length === 0 ? (
                  <p className="text-purple-200">No sessions yet. Start a focus block to begin tracking.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {recentSessions.map((session) => (
                      <div key={session.id} className="bg-white/5 rounded-xl p-4 border border-white/5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm px-3 py-1 rounded-full bg-white/10 text-white">
                            {session.mode === 'focus' ? 'Focus' : 'Break'}
                          </span>
                          <span className="text-xs text-purple-200">
                            {new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <p className="mt-3 text-lg font-semibold text-white">{session.subject}</p>
                        <p className="text-sm text-purple-200">Duration: {Math.round(session.durationSeconds / 60)} min</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white/10 backdrop-blur-lg border border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
                <h2 className="text-xl font-bold">Analytics</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-xs text-purple-200 uppercase">Weekly Minutes</p>
                    <p className="text-3xl font-bold text-vibrant-yellow mt-1">{weekly.totalMinutes}</p>
                    <p className="text-xs text-purple-200">{weekly.sessionsCount} sessions</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-xs text-purple-200 uppercase">Monthly Minutes</p>
                    <p className="text-3xl font-bold text-vibrant-yellow mt-1">{monthly.totalMinutes}</p>
                    <p className="text-xs text-purple-200">{monthly.sessionsCount} sessions</p>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs text-purple-200 uppercase">Top Subject (7d)</p>
                  {weekly.topSubject ? (
                    <>
                      <p className="text-lg font-semibold">{weekly.topSubject.name}</p>
                      <p className="text-sm text-purple-200">{weekly.topSubject.minutes} minutes</p>
                    </>
                  ) : (
                    <p className="text-sm text-purple-200">Start a session to see trends</p>
                  )}
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs text-purple-200 uppercase">Streaks</p>
                  <p className="text-lg font-semibold">Current: {streaks.streak} days</p>
                  <p className="text-sm text-purple-200">Best: {streaks.longest} days</p>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-lg border border-white/10 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold">Leaderboard</h2>
                  <span className="text-xs text-purple-200">Based on streaks</span>
                </div>
                <div className="space-y-2">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={entry.username}
                      className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 border border-white/5"
                    >
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-purple-200 w-6 text-center">{index + 1}</span>
                        <span className={`font-semibold ${entry.username === username ? 'text-vibrant-yellow' : 'text-white'}`}>
                          {entry.username}
                        </span>
                      </div>
                      <span className="text-sm text-purple-100">{entry.streak} day streak</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-purple-200 mt-3">
                  Leaderboard is local to your device to respect privacy. Sign in to keep your name consistent across sessions.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
