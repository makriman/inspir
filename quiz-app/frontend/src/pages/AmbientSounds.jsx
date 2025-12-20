import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import API_URL from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const LOCAL_KEY = 'inspirquiz_ambient_sounds_prefs_v1';

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

function createNoiseBuffer(ctx, seconds = 2) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export default function AmbientSounds() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const isAuthed = Boolean(token);

  const [loading, setLoading] = useState(isAuthed);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [error, setError] = useState('');

  const [masterVolume, setMasterVolume] = useState(0.5);
  const [mix, setMix] = useState({ white: 0.15, rain: 0.25, waves: 0.1 });
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef({
    ctx: null,
    masterGain: null,
    channels: null,
    cleanup: null,
  });

  useEffect(() => {
    const boot = async () => {
      if (isAuthed) {
        setLoading(true);
        try {
          const res = await axios.get(`${API_URL}/audio/preferences?toolId=ambient-sounds`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const prefs = res.data.preferences || {};
          setMasterVolume(typeof prefs.volume === 'number' ? prefs.volume : 0.5);
          const saved = prefs.settings && typeof prefs.settings === 'object' ? prefs.settings : {};
          setMix({
            white: typeof saved.white === 'number' ? saved.white : 0.15,
            rain: typeof saved.rain === 'number' ? saved.rain : 0.25,
            waves: typeof saved.waves === 'number' ? saved.waves : 0.1,
          });
        } catch (e) {
          console.error('Failed to load ambient prefs:', e);
        } finally {
          setLoading(false);
        }
        return;
      }

      const local = loadJson(LOCAL_KEY, null);
      if (local) {
        setMasterVolume(typeof local.volume === 'number' ? local.volume : 0.5);
        const saved = local.settings && typeof local.settings === 'object' ? local.settings : {};
        setMix({
          white: typeof saved.white === 'number' ? saved.white : 0.15,
          rain: typeof saved.rain === 'number' ? saved.rain : 0.25,
          waves: typeof saved.waves === 'number' ? saved.waves : 0.1,
        });
      }
      setLoading(false);
    };
    boot();
  }, [isAuthed, token]);

  useEffect(() => {
    if (isAuthed) return;
    saveJson(LOCAL_KEY, { volume: masterVolume, settings: mix, updated_at: new Date().toISOString() });
    setLastSavedAt(new Date().toISOString());
  }, [masterVolume, mix, isAuthed]);

  const ensureAudio = async () => {
    if (!audioRef.current.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = new GainNode(ctx, { gain: masterVolume });
      masterGain.connect(ctx.destination);
      audioRef.current.ctx = ctx;
      audioRef.current.masterGain = masterGain;
    }
    const ctx = audioRef.current.ctx;
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const buildGraph = () => {
    const ctx = audioRef.current.ctx;
    const masterGain = audioRef.current.masterGain;

    const whiteGain = new GainNode(ctx, { gain: clamp01(mix.white) });
    const rainGain = new GainNode(ctx, { gain: clamp01(mix.rain) });
    const wavesGain = new GainNode(ctx, { gain: clamp01(mix.waves) });

    whiteGain.connect(masterGain);
    rainGain.connect(masterGain);
    wavesGain.connect(masterGain);

    const buffer = createNoiseBuffer(ctx, 2);

    const whiteSource = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    whiteSource.connect(whiteGain);

    const rainSource = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    const rainHp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 500, Q: 0.7 });
    const rainLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2500, Q: 0.7 });
    rainSource.connect(rainHp).connect(rainLp).connect(rainGain);

    const waveOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 120 });
    const waveFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260, Q: 0.8 });
    const tremolo = new GainNode(ctx, { gain: 0.25 });
    const lfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.18 });
    const lfoGain = new GainNode(ctx, { gain: 0.15 });
    lfo.connect(lfoGain).connect(tremolo.gain);
    waveOsc.connect(tremolo).connect(waveFilter).connect(wavesGain);

    whiteSource.start();
    rainSource.start();
    waveOsc.start();
    lfo.start();

    audioRef.current.channels = { whiteGain, rainGain, wavesGain, masterGain };

    return () => {
      try {
        whiteSource.stop();
        rainSource.stop();
        waveOsc.stop();
        lfo.stop();
      } catch {
        // ignore
      }
      whiteSource.disconnect();
      rainSource.disconnect();
      waveOsc.disconnect();
      lfo.disconnect();
      whiteGain.disconnect();
      rainGain.disconnect();
      wavesGain.disconnect();
      rainHp.disconnect();
      rainLp.disconnect();
      tremolo.disconnect();
      waveFilter.disconnect();
      lfoGain.disconnect();
    };
  };

  useEffect(() => {
    const { ctx, masterGain } = audioRef.current;
    if (!ctx || !masterGain) return;
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.03);
  }, [masterVolume]);

  useEffect(() => {
    if (!isPlaying) return;
    const { ctx, channels } = audioRef.current;
    if (!ctx || !channels) return;
    channels.whiteGain.gain.setTargetAtTime(clamp01(mix.white), ctx.currentTime, 0.03);
    channels.rainGain.gain.setTargetAtTime(clamp01(mix.rain), ctx.currentTime, 0.03);
    channels.wavesGain.gain.setTargetAtTime(clamp01(mix.waves), ctx.currentTime, 0.03);
  }, [mix, isPlaying]);

  useEffect(() => {
    return () => {
      if (audioRef.current.cleanup) audioRef.current.cleanup();
      if (audioRef.current.ctx && audioRef.current.ctx.state !== 'closed') {
        audioRef.current.ctx.close().catch(() => {});
      }
    };
  }, []);

  const start = async () => {
    setError('');
    try {
      await ensureAudio();
      if (audioRef.current.cleanup) audioRef.current.cleanup();
      audioRef.current.cleanup = buildGraph();
      setIsPlaying(true);
    } catch (e) {
      console.error(e);
      setError('Audio could not start. Try again.');
    }
  };

  const stop = () => {
    if (audioRef.current.cleanup) audioRef.current.cleanup();
    audioRef.current.cleanup = null;
    audioRef.current.channels = null;
    setIsPlaying(false);
  };

  const save = async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError('');
    try {
      await axios.put(
        `${API_URL}/audio/preferences`,
        { tool_id: 'ambient-sounds', volume: masterVolume, preset_id: 'mixer', settings: mix },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLastSavedAt(new Date().toISOString());
    } catch (e) {
      console.error(e);
      setError('Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const mixLabel = useMemo(() => {
    const active = Object.entries(mix)
      .filter(([, v]) => v > 0.02)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k]) => k);
    return active.length ? active.join(' + ') : 'silent';
  }, [mix]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-white py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-block bg-purple-100 rounded-full px-4 py-2 mb-4">
            <span className="text-purple-700 font-semibold text-sm">Focus & Productivity</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">Ambient Sounds</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Build a simple ambient mix for studying: rain, noise, and gentle waves.
          </p>
          {!isAuthed && (
            <p className="text-sm text-gray-500 mt-3">
              Guest mode: preferences save to this device. Sign in to sync them.
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Mixer</h2>
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
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-bold text-gray-800 mb-2">Master volume</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={masterVolume}
                onChange={(e) => setMasterVolume(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">Current mix: {mixLabel}</div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-bold text-gray-800 mb-2">Controls</div>
              {!isPlaying ? (
                <button
                  onClick={start}
                  className="w-full px-6 py-3 rounded-xl bg-gray-900 text-white font-extrabold hover:bg-gray-800 transition-all"
                >
                  Play
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="w-full px-6 py-3 rounded-xl bg-white border border-gray-200 text-gray-900 font-extrabold hover:border-purple-300 transition-all"
                >
                  Stop
                </button>
              )}
              {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="font-bold text-gray-900 mb-2">White Noise</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={mix.white}
                onChange={(e) => setMix((m) => ({ ...m, white: Number(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">Good for masking chatter.</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="font-bold text-gray-900 mb-2">Rain</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={mix.rain}
                onChange={(e) => setMix((m) => ({ ...m, rain: Number(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">A softer filtered noise texture.</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="font-bold text-gray-900 mb-2">Waves</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={mix.waves}
                onChange={(e) => setMix((m) => ({ ...m, waves: Number(e.target.value) }))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">A gentle undulating tone.</div>
            </div>
          </div>

          <div className="mt-8 p-4 rounded-xl bg-purple-50 border border-purple-100 text-sm text-purple-900">
            <div className="font-bold mb-1">Tip</div>
            Keep a little background sound on while you work, then stop it during short breaks to reset your attention.
          </div>
        </div>
      </div>
    </div>
  );
}

