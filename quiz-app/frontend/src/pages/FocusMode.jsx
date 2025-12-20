import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const PRESETS_KEY = 'inspirquiz_timer_presets_v1';
const ACTIVE_PRESET_KEY = 'inspirquiz_timer_active_preset_v1';
const SESSIONS_KEY = 'inspirquiz_study_sessions_v1';
const TASKS_KEY = 'inspirquiz_focus_tasks_v1';
const BLOCKLIST_KEY = 'inspirquiz_focus_blocklist_v1';

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

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

export default function FocusMode() {
  const { user } = useAuth();
  const username = user?.username || 'Guest';

  const presets = useMemo(() => loadJson(PRESETS_KEY, []), []);
  const activePresetId = useMemo(() => localStorage.getItem(ACTIVE_PRESET_KEY), []);
  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) || null,
    [presets, activePresetId]
  );

  const [subject, setSubject] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(activePreset?.focusMinutes || 25);
  const [secondsLeft, setSecondsLeft] = useState((activePreset?.focusMinutes || 25) * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(null);

  const [tasks, setTasks] = useState(() => loadJson(TASKS_KEY, []));
  const [newTask, setNewTask] = useState('');
  const [blocklist, setBlocklist] = useState(() => loadJson(BLOCKLIST_KEY, ['youtube.com', 'tiktok.com']));
  const [newBlock, setNewBlock] = useState('');

  const intervalRef = useRef(null);

  useEffect(() => {
    if (!activePreset) return;
    localStorage.removeItem(ACTIVE_PRESET_KEY);
  }, [activePreset]);

  useEffect(() => {
    saveJson(TASKS_KEY, tasks);
  }, [tasks]);

  useEffect(() => {
    saveJson(BLOCKLIST_KEY, blocklist);
  }, [blocklist]);

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
    if (!isRunning) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    if (secondsLeft > 0) return;

    setIsRunning(false);
    const endedAt = new Date().toISOString();
    const started = startedAt || new Date(Date.now() - focusMinutes * 60 * 1000).toISOString();

    const sessions = loadJson(SESSIONS_KEY, []);
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      username,
      subject: subject.trim() || 'Focus Mode',
      durationSeconds: focusMinutes * 60,
      mode: 'focus',
      startedAt: started,
      endedAt,
    };
    saveJson(SESSIONS_KEY, [entry, ...sessions].slice(0, 500));
  }, [secondsLeft, isRunning, username, subject, focusMinutes, startedAt]);

  const start = async () => {
    setStartedAt(new Date().toISOString());
    setSecondsLeft(Math.max(1, focusMinutes) * 60);
    setIsRunning(true);
  };

  const stop = () => {
    setIsRunning(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const addTask = () => {
    const trimmed = newTask.trim();
    if (!trimmed) return;
    setTasks((prev) => [{ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text: trimmed, done: false }, ...prev]);
    setNewTask('');
  };

  const toggleTask = (id) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTask = (id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const addBlock = () => {
    const trimmed = newBlock.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!trimmed) return;
    if (blocklist.includes(trimmed)) return;
    setBlocklist((prev) => [trimmed, ...prev].slice(0, 20));
    setNewBlock('');
  };

  const removeBlock = (domain) => {
    setBlocklist((prev) => prev.filter((d) => d !== domain));
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
          <div>
            <div className="inline-block bg-white/10 rounded-full px-4 py-2 mb-4">
              <span className="text-white font-semibold text-sm">Focus Mode</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold">Distraction-free study sprint</h1>
            <p className="text-white/70 mt-3 max-w-2xl">
              Full-screen timer + task list. Leaving the page prompts you while a sprint is active.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleFullscreen}
              className="px-4 py-2 rounded-lg font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition-all"
            >
              Toggle Fullscreen
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                <div className="text-5xl font-mono tracking-widest">{formatDuration(Math.max(0, secondsLeft))}</div>
                <div className="flex items-center gap-2">
                  {!isRunning ? (
                    <button
                      onClick={start}
                      className="px-5 py-3 rounded-xl font-semibold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 transition-all"
                    >
                      Start sprint
                    </button>
                  ) : (
                    <button
                      onClick={stop}
                      className="px-5 py-3 rounded-xl font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition-all"
                    >
                      Stop
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-white/80 mb-2">Focus subject</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g., Biology notes"
                    className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-white/10 focus:outline-none focus:border-purple-400"
                    disabled={isRunning}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white/80 mb-2">Minutes</label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={focusMinutes}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setFocusMinutes(next);
                      if (!isRunning) setSecondsLeft(next * 60);
                    }}
                    className="w-full px-4 py-3 rounded-lg bg-gray-900 border border-white/10 focus:outline-none focus:border-purple-400"
                    disabled={isRunning}
                  />
                </div>
              </div>

              {activePreset && (
                <div className="mt-4 text-sm text-white/70">
                  Preset applied: <span className="font-semibold text-white">{activePreset.name}</span>
                </div>
              )}

              <div className="mt-6 bg-gray-900/60 border border-white/10 rounded-xl p-4">
                <div className="text-sm font-semibold text-white/80 mb-2">Website blocker (lightweight)</div>
                <div className="text-sm text-white/60">
                  This blocks nothing outside the app, but it helps you commit: write down distractions you want to avoid.
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={newBlock}
                    onChange={(e) => setNewBlock(e.target.value)}
                    placeholder="Add a domain (e.g., youtube.com)"
                    className="flex-1 px-4 py-2 rounded-lg bg-gray-950 border border-white/10 focus:outline-none focus:border-purple-400"
                  />
                  <button
                    onClick={addBlock}
                    className="px-4 py-2 rounded-lg font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition-all"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {blocklist.map((domain) => (
                    <button
                      key={domain}
                      onClick={() => removeBlock(domain)}
                      className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 text-sm"
                      title="Remove"
                    >
                      {domain}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="text-2xl font-bold">Tasks</h2>
                <span className="text-sm text-white/60">{tasks.filter((t) => t.done).length}/{tasks.length} done</span>
              </div>

              <div className="flex gap-2 mb-4">
                <input
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  placeholder="Add a task…"
                  className="flex-1 px-4 py-3 rounded-lg bg-gray-900 border border-white/10 focus:outline-none focus:border-purple-400"
                />
                <button
                  onClick={addTask}
                  className="px-4 py-2 rounded-lg font-semibold bg-white/10 hover:bg-white/15 border border-white/10 transition-all"
                  disabled={!newTask.trim()}
                >
                  Add
                </button>
              </div>

              {tasks.length === 0 ? (
                <div className="text-white/60">No tasks yet. Add one above.</div>
              ) : (
                <div className="space-y-2">
                  {tasks.slice(0, 20).map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3 bg-gray-900/60 border border-white/10 rounded-xl px-4 py-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                        <span className={task.done ? 'line-through text-white/50' : 'text-white'}>
                          {task.text}
                        </span>
                      </label>
                      <button onClick={() => removeTask(task.id)} className="text-white/60 hover:text-white text-sm">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-xl font-bold mb-2">Quick rules</h3>
              <ul className="text-white/70 text-sm list-disc pl-5 space-y-1">
                <li>One sprint, one goal.</li>
                <li>Write your next action as a task.</li>
                <li>If distracted, add it to the list instead of acting on it.</li>
                <li>When the timer ends, the session is logged to your tracker.</li>
              </ul>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-xl font-bold mb-2">Privacy</h3>
              <p className="text-white/70 text-sm">
                Focus Mode stores tasks, blocklist, and logged sessions locally in your browser.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
