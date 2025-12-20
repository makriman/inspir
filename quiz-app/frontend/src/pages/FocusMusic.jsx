import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const LOCAL_KEY = 'inspirquiz_focus_music_prefs_v1';

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

const PRESETS = [
  {
    id: 'binaural-alpha',
    name: 'Binaural Alpha (calm focus)',
    description: 'A gentle binaural beat designed for relaxed concentration.',
    type: 'binaural',
    baseHz: 200,
    beatHz: 10,
  },
  {
    id: 'binaural-beta',
    name: 'Binaural Beta (active focus)',
    description: 'A slightly faster binaural beat for active work.',
    type: 'binaural',
    baseHz: 210,
    beatHz: 16,
  },
  {
    id: 'soft-drone',
    name: 'Soft Drone (lo-fi pad)',
    description: 'A soft synth-like drone that stays out of your way.',
    type: 'drone',
    baseHz: 110,
  },
];

function createBinaural(ctx, masterGain, { baseHz, beatHz }) {
  const leftOsc = new OscillatorNode(ctx, { type: 'sine', frequency: baseHz - beatHz / 2 });
  const rightOsc = new OscillatorNode(ctx, { type: 'sine', frequency: baseHz + beatHz / 2 });

  const leftPan = new StereoPannerNode(ctx, { pan: -0.9 });
  const rightPan = new StereoPannerNode(ctx, { pan: 0.9 });

  const leftGain = new GainNode(ctx, { gain: 0.18 });
  const rightGain = new GainNode(ctx, { gain: 0.18 });

  leftOsc.connect(leftGain).connect(leftPan).connect(masterGain);
  rightOsc.connect(rightGain).connect(rightPan).connect(masterGain);

  leftOsc.start();
  rightOsc.start();

  return () => {
    try {
      leftOsc.stop();
      rightOsc.stop();
    } catch {
      // ignore
    }
    leftOsc.disconnect();
    rightOsc.disconnect();
    leftGain.disconnect();
    rightGain.disconnect();
    leftPan.disconnect();
    rightPan.disconnect();
  };
}

function createDrone(ctx, masterGain, { baseHz }) {
  const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 650, Q: 0.6 });
  filter.connect(masterGain);

  const gain = new GainNode(ctx, { gain: 0.22 });
  gain.connect(filter);

  const osc1 = new OscillatorNode(ctx, { type: 'triangle', frequency: baseHz });
  const osc2 = new OscillatorNode(ctx, { type: 'sine', frequency: baseHz * 2, detune: -6 });
  const osc3 = new OscillatorNode(ctx, { type: 'sine', frequency: baseHz * 1.5, detune: 8 });

  osc1.connect(gain);
  osc2.connect(gain);
  osc3.connect(gain);

  osc1.start();
  osc2.start();
  osc3.start();

  return () => {
    try {
      osc1.stop();
      osc2.stop();
      osc3.stop();
    } catch {
      // ignore
    }
    osc1.disconnect();
    osc2.disconnect();
    osc3.disconnect();
    gain.disconnect();
    filter.disconnect();
  };
}

function buildPresetNodes(ctx, masterGain, preset) {
  if (preset.type === 'binaural') return createBinaural(ctx, masterGain, preset);
  return createDrone(ctx, masterGain, preset);
}

export default function FocusMusic() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [volume, setVolume] = useState(0.5);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');

  const audioRef = useRef({ ctx: null, masterGain: null, cleanup: null });

  const preset = useMemo(() => PRESETS.find((p) => p.id === presetId) || PRESETS[0], [presetId]);

  useEffect(() => {
    const boot = async () => {
      if (isAuthed) {
        setLoading(true);
        try {
          const res = await axios.get(`${API_URL}/audio/preferences?toolId=focus-music`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const prefs = res.data.preferences || {};
          setVolume(typeof prefs.volume === 'number' ? prefs.volume : 0.5);
          setPresetId(prefs.preset_id || PRESETS[0].id);
        } catch (e) {
          console.error('Failed to load focus music prefs:', e);
        } finally {
          setLoading(false);
        }
        return;
      }

      const local = loadJson(LOCAL_KEY, null);
      if (local) {
        setVolume(typeof local.volume === 'number' ? local.volume : 0.5);
        setPresetId(local.preset_id || PRESETS[0].id);
      }
      setLoading(false);
    };
    boot();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_KEY, { volume, preset_id: presetId, updated_at: new Date().toISOString() });
    setLastSavedAt(new Date().toISOString());
  }, [volume, presetId, isAuthed]);

  useEffect(() => {
    const { ctx, masterGain } = audioRef.current;
    if (!ctx || !masterGain) return;
    try {
      masterGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
    } catch {
      // ignore
    }
  }, [volume]);

  useEffect(() => {
    if (!isPlaying) return;
    // Rebuild sound graph when preset changes.
    const { ctx, masterGain } = audioRef.current;
    if (!ctx || !masterGain) return;
    if (audioRef.current.cleanup) audioRef.current.cleanup();
    audioRef.current.cleanup = buildPresetNodes(ctx, masterGain, preset);
  }, [preset, isPlaying]);

  useEffect(() => {
    return () => {
      const { ctx, cleanup } = audioRef.current;
      if (cleanup) cleanup();
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    };
  }, []);

  const ensureAudio = async () => {
    if (!audioRef.current.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = new GainNode(ctx, { gain: volume });
      masterGain.connect(ctx.destination);
      audioRef.current.ctx = ctx;
      audioRef.current.masterGain = masterGain;
    }
    const ctx = audioRef.current.ctx;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  };

  const start = async () => {
    setError('');
    try {
      await ensureAudio();
      const { ctx, masterGain } = audioRef.current;
      if (audioRef.current.cleanup) audioRef.current.cleanup();
      audioRef.current.cleanup = buildPresetNodes(ctx, masterGain, preset);
      setIsPlaying(true);
    } catch (e) {
      console.error(e);
      setError('Audio could not start. Try clicking Play again.');
    }
  };

  const stop = () => {
    if (audioRef.current.cleanup) audioRef.current.cleanup();
    audioRef.current.cleanup = null;
    setIsPlaying(false);
  };

  const save = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.put(
        `${API_URL}/audio/preferences`,
        { tool_id: 'focus-music', volume, preset_id: presetId, settings: {} },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const prefs = res.data.preferences || {};
      setVolume(typeof prefs.volume === 'number' ? prefs.volume : volume);
      setPresetId(prefs.preset_id || presetId);
      setLastSavedAt(new Date().toISOString());
    } catch (e) {
      console.error('Failed to save focus music prefs:', e);
      setError('Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Music for Focus</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Minimal, distraction-free audio to help you enter flow — no accounts or subscriptions needed.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: preferences save to this device. Sign in to sync them.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Player</h2>
            <div className="flex items-center gap-2">
              {lastSavedAt && !loading && (
                <span className="text-xs text-gray-500">Saved {new Date(lastSavedAt).toLocaleTimeString()}</span>
              )}
              {isAuthed && (
                <button
                  onClick={save}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all disabled:opacity-50"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Preset</label>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-purple-500 focus:outline-none bg-white"
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="text-xs text-gray-500 mt-2">{preset.description}</div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Volume</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">Tip: keep this low and let your brain adapt.</div>
            </div>
          </div>

          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

          <div className="mt-6 flex flex-wrap gap-3 items-center">
            {!isPlaying ? (
              <button
                onClick={start}
                className="px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all"
              >
                Play
              </button>
            ) : (
              <button
                onClick={stop}
                className="px-6 py-3 rounded-xl bg-white border border-gray-200 text-gray-900 font-extrabold hover:border-purple-300 transition-all"
              >
                Stop
              </button>
            )}
            <div className="text-sm text-gray-600">
              {isPlaying ? 'Playing' : 'Paused'} • Works best with headphones for binaural presets.
            </div>
          </div>

          <div className="mt-8 p-4 rounded-xl bg-purple-50 border border-purple-100 text-sm text-purple-900">
            <div className="font-bold mb-1">Safety note</div>
            If you’re sensitive to audio stimulation, keep volume low and stop if you feel discomfort.
          </div>
        </div>
      </div>
    </div>
  );
}

