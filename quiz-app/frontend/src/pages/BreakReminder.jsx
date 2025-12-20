import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const LOCAL_KEY = 'inspirquiz_break_reminder_settings_v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export default function BreakReminder() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [settings, setSettings] = useState(() => loadSettings() || {
    enabled: true,
    work_minutes: 50,
    break_minutes: 10,
    sound_enabled: true,
    notifications_enabled: false,
  });
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const [demoActive, setDemoActive] = useState(false);
  const [demoSeconds, setDemoSeconds] = useState(0);

  useEffect(() => {
    if (!isAuthed) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API_URL}/productivity/break-reminder/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSettings(res.data.settings);
      } catch (error) {
        console.error('Failed to load break reminder settings:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveSettings(settings);
    setLastSavedAt(new Date().toISOString());
  }, [settings, isAuthed]);

  const requestNotifications = async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  };

  const pushNotification = (title, body) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // eslint-disable-next-line no-new
    new Notification(title, { body });
  };

  const save = async () => {
    if (!isAuthed) return;
    setLoading(true);
    try {
      const res = await axios.put(
        `${API_URL}/productivity/break-reminder/settings`,
        settings,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSettings(res.data.settings);
      setLastSavedAt(new Date().toISOString());
    } catch (error) {
      console.error('Failed to save break reminder settings:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!demoActive) return;
    const t = setInterval(() => setDemoSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [demoActive]);

  useEffect(() => {
    if (!demoActive) return;
    if (!settings.enabled) return;
    if (demoSeconds <= 0) return;

    const workSeconds = settings.work_minutes * 60;
    const breakSeconds = settings.break_minutes * 60;
    const cycle = workSeconds + breakSeconds;
    const within = demoSeconds % cycle;
    const isWork = within < workSeconds;

    if (within === 0) return;
    if (within === workSeconds) {
      if (settings.sound_enabled) {
        try {
          const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAA');
          audio.play().catch(() => {});
        } catch {
          // ignore
        }
      }
      pushNotification('Break time', 'Take a short break to reset your focus.');
    }
    if (within === 1 && isWork) {
      pushNotification('Focus time', 'Back to work — you’ve got this.');
    }
  }, [demoSeconds, demoActive, settings]);

  const phase = useMemo(() => {
    const workSeconds = settings.work_minutes * 60;
    const breakSeconds = settings.break_minutes * 60;
    const cycle = workSeconds + breakSeconds;
    const within = demoSeconds % cycle;
    const isWork = within < workSeconds;
    const phaseSecondsLeft = isWork ? workSeconds - within : cycle - within;
    return {
      isWork,
      phaseSecondsLeft,
    };
  }, [demoSeconds, settings]);

  const formattedLeft = useMemo(() => {
    const mins = Math.floor(phase.phaseSecondsLeft / 60);
    const secs = phase.phaseSecondsLeft % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [phase.phaseSecondsLeft]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Break Reminder</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Gentle reminders to take breaks — and come back with energy.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: settings save to this device. Sign in to sync them.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
            <div className="flex items-center gap-2">
              {loading && <span className="text-sm text-gray-500">Saving…</span>}
              {lastSavedAt && !loading && (
                <span className="text-xs text-gray-500">Saved {new Date(lastSavedAt).toLocaleTimeString()}</span>
              )}
              {isAuthed && (
                <button
                  onClick={save}
                  className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
              />
              <span className="font-semibold text-gray-800">Enabled</span>
            </label>

            <label className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <input
                type="checkbox"
                checked={settings.sound_enabled}
                onChange={(e) => setSettings((s) => ({ ...s, sound_enabled: e.target.checked }))}
              />
              <span className="font-semibold text-gray-800">Sound cue</span>
            </label>

            <label className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <input
                type="checkbox"
                checked={settings.notifications_enabled}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  if (checked) {
                    const ok = await requestNotifications();
                    setSettings((s) => ({ ...s, notifications_enabled: ok }));
                    return;
                  }
                  setSettings((s) => ({ ...s, notifications_enabled: false }));
                }}
              />
              <span className="font-semibold text-gray-800">Browser notifications</span>
            </label>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-semibold text-gray-700 mb-2">Work / Break</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Work (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={settings.work_minutes}
                    onChange={(e) => setSettings((s) => ({ ...s, work_minutes: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-purple-500 focus:outline-none bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Break (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.break_minutes}
                    onChange={(e) => setSettings((s) => ({ ...s, break_minutes: Number(e.target.value) }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-purple-500 focus:outline-none bg-white"
                  />
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Tip: 50/10 for deep work, 25/5 for Pomodoro.
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Live preview</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDemoActive((v) => !v)}
                className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                  demoActive ? 'bg-white border border-gray-200 text-gray-800 hover:border-purple-300' : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                {demoActive ? 'Stop' : 'Start'}
              </button>
              <button
                onClick={() => setDemoSeconds(0)}
                className="px-4 py-2 rounded-lg font-semibold bg-white border border-gray-200 text-gray-700 hover:border-purple-300 transition-all"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="bg-gray-950 rounded-2xl p-6 text-white">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm text-white/70">Current phase</div>
                <div className="text-2xl font-extrabold">{settings.enabled ? (phase.isWork ? 'Focus' : 'Break') : 'Disabled'}</div>
              </div>
              <div className="text-4xl font-mono">{settings.enabled ? formattedLeft : '--:--'}</div>
              <div className="text-sm text-white/70">
                Notifications: {settings.notifications_enabled ? 'On' : 'Off'}
              </div>
            </div>
            <div className="mt-4 text-sm text-white/70">
              This preview uses your configured durations. In the full version, reminders can run alongside timers.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

