"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { formatSeconds } from "@/components/chat/persistent-learning-format";

type TimerMode = "focus" | "break";

type FocusTimerState = {
  subject: string;
  focusMinutes: number;
  breakMinutes: number;
  mode: TimerMode;
  secondsLeft: number;
  running: boolean;
  endsAt: number | null;
  completedFocusSessions: number;
  totalFocusSeconds: number;
  notificationsEnabled: boolean;
  ringing: boolean;
};

type FocusMusicState = {
  presetId: string;
  volume: number;
  playing: boolean;
};

type FocusMusicPreset = {
  id: string;
  name: string;
  description: string;
  kind: "binaural" | "drone" | "rain";
  baseHz: number;
  beatHz?: number;
};

type Cleanup = () => void;

type AudioKit = {
  ctx: AudioContext | null;
  masterGain: GainNode | null;
  cleanup: Cleanup | null;
};

const timerStorageKey = "inspir_learning_timer_v1";
const musicStorageKey = "inspir_learning_music_v1";

const musicPresets: FocusMusicPreset[] = [
  {
    id: "alpha-focus",
    name: "Alpha focus",
    description: "A calm binaural bed for reading, notes, and problem solving.",
    kind: "binaural",
    baseHz: 210,
    beatHz: 10,
  },
  {
    id: "deep-work",
    name: "Deep work",
    description: "A steady low drone for longer concentration blocks.",
    kind: "drone",
    baseHz: 96,
  },
  {
    id: "rain-room",
    name: "Rain room",
    description: "Soft synthetic rain noise with a warm low-pass filter.",
    kind: "rain",
    baseHz: 440,
  },
];

function defaultTimer(): FocusTimerState {
  return {
    subject: "",
    focusMinutes: 25,
    breakMinutes: 5,
    mode: "focus",
    secondsLeft: 25 * 60,
    running: false,
    endsAt: null,
    completedFocusSessions: 0,
    totalFocusSeconds: 0,
    notificationsEnabled: false,
    ringing: false,
  };
}

function defaultMusic(): FocusMusicState {
  return {
    presetId: musicPresets[0].id,
    volume: 0.42,
    playing: false,
  };
}

function readJson<Value>(key: string, fallback: Value): Value {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as Value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is a convenience; the tools still work without it.
  }
}

function readStoredTimer(): FocusTimerState {
  const storedTimer = readJson(timerStorageKey, defaultTimer());
  return {
    ...storedTimer,
    running: false,
    endsAt: null,
    secondsLeft: Math.max(1, storedTimer.secondsLeft || storedTimer.focusMinutes * 60),
  };
}

function readStoredMusic(): FocusMusicState {
  const storedMusic = readJson(musicStorageKey, defaultMusic());
  return { ...storedMusic, playing: false };
}

function clampMinutes(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(180, Math.max(1, Math.round(value)));
}

function audioContextCtor() {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function createBinaural(ctx: AudioContext, masterGain: GainNode, preset: FocusMusicPreset): Cleanup {
  const beatHz = preset.beatHz ?? 8;
  const leftOsc = new OscillatorNode(ctx, { type: "sine", frequency: preset.baseHz - beatHz / 2 });
  const rightOsc = new OscillatorNode(ctx, { type: "sine", frequency: preset.baseHz + beatHz / 2 });
  const leftPan = new StereoPannerNode(ctx, { pan: -0.85 });
  const rightPan = new StereoPannerNode(ctx, { pan: 0.85 });
  const leftGain = new GainNode(ctx, { gain: 0.18 });
  const rightGain = new GainNode(ctx, { gain: 0.18 });

  leftOsc.connect(leftGain).connect(leftPan).connect(masterGain);
  rightOsc.connect(rightGain).connect(rightPan).connect(masterGain);
  leftOsc.start();
  rightOsc.start();

  return () => {
    leftOsc.stop();
    rightOsc.stop();
    leftOsc.disconnect();
    rightOsc.disconnect();
    leftGain.disconnect();
    rightGain.disconnect();
    leftPan.disconnect();
    rightPan.disconnect();
  };
}

function createDrone(ctx: AudioContext, masterGain: GainNode, preset: FocusMusicPreset): Cleanup {
  const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 720, Q: 0.7 });
  const gain = new GainNode(ctx, { gain: 0.22 });
  const oscA = new OscillatorNode(ctx, { type: "triangle", frequency: preset.baseHz });
  const oscB = new OscillatorNode(ctx, { type: "sine", frequency: preset.baseHz * 1.5, detune: -7 });
  const oscC = new OscillatorNode(ctx, { type: "sine", frequency: preset.baseHz * 2, detune: 5 });

  oscA.connect(gain);
  oscB.connect(gain);
  oscC.connect(gain);
  gain.connect(filter).connect(masterGain);
  oscA.start();
  oscB.start();
  oscC.start();

  return () => {
    oscA.stop();
    oscB.stop();
    oscC.stop();
    oscA.disconnect();
    oscB.disconnect();
    oscC.disconnect();
    gain.disconnect();
    filter.disconnect();
  };
}

function createRain(ctx: AudioContext, masterGain: GainNode): Cleanup {
  const bufferSize = 2 * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < bufferSize; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
  const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 950, Q: 0.35 });
  const gain = new GainNode(ctx, { gain: 0.16 });
  source.connect(filter).connect(gain).connect(masterGain);
  source.start();

  return () => {
    source.stop();
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

function buildMusicGraph(ctx: AudioContext, masterGain: GainNode, preset: FocusMusicPreset): Cleanup {
  if (preset.kind === "binaural") return createBinaural(ctx, masterGain, preset);
  if (preset.kind === "rain") return createRain(ctx, masterGain);
  return createDrone(ctx, masterGain, preset);
}

function notifyTimer(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification(title, { body });
}

function playTimerChime() {
  if (typeof window === "undefined") return;
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  const ctx = new Ctor();
  const gain = new GainNode(ctx, { gain: 0.0001 });
  gain.connect(ctx.destination);

  const notes = [660, 880, 990];
  notes.forEach((frequency, index) => {
    const osc = new OscillatorNode(ctx, { type: "sine", frequency });
    const start = ctx.currentTime + index * 0.16;
    const end = start + 0.18;
    osc.connect(gain);
    gain.gain.setTargetAtTime(0.18, start, 0.015);
    gain.gain.setTargetAtTime(0.0001, end, 0.035);
    osc.start(start);
    osc.stop(end + 0.08);
  });

  window.setTimeout(() => {
    ctx.close().catch(() => {});
  }, 900);
}

export function usePersistentLearningTools() {
  const [timer, setTimer] = useState<FocusTimerState>(() => readStoredTimer());
  const [music, setMusic] = useState<FocusMusicState>(() => readStoredMusic());
  const timerRef = useRef(timer);
  const musicKitRef = useRef<AudioKit>({ ctx: null, masterGain: null, cleanup: null });

  const activeMusicPreset = useMemo(
    () => musicPresets.find((preset) => preset.id === music.presetId) ?? musicPresets[0],
    [music.presetId],
  );

  useEffect(() => {
    timerRef.current = timer;
    writeJson(timerStorageKey, { ...timer, running: false, endsAt: null });
  }, [timer]);

  useEffect(() => {
    writeJson(musicStorageKey, { ...music, playing: false });
  }, [music]);

  useEffect(() => {
    if (!timer.running || !timer.endsAt) return;
    const tick = () => {
      const current = timerRef.current;
      if (!current.running || !current.endsAt) return;
      const remaining = Math.ceil((current.endsAt - Date.now()) / 1000);
      if (remaining > 0) {
        setTimer((state) => ({ ...state, secondsLeft: remaining }));
        return;
      }

      const finishedMode = current.mode;
      const nextMode: TimerMode = finishedMode === "focus" ? "break" : "focus";
      const nextSeconds = (nextMode === "focus" ? current.focusMinutes : current.breakMinutes) * 60;
      setTimer((state) => ({
        ...state,
        mode: nextMode,
        secondsLeft: nextSeconds,
        running: false,
        endsAt: null,
        ringing: true,
        completedFocusSessions:
          finishedMode === "focus" ? state.completedFocusSessions + 1 : state.completedFocusSessions,
        totalFocusSeconds:
          finishedMode === "focus" ? state.totalFocusSeconds + state.focusMinutes * 60 : state.totalFocusSeconds,
      }));
      playTimerChime();
      if (current.notificationsEnabled) {
        notifyTimer(
          finishedMode === "focus" ? "Focus session complete" : "Break complete",
          finishedMode === "focus" ? "Take a real break before the next round." : "Ready for the next focus round.",
        );
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [timer.running, timer.endsAt]);

  useEffect(() => {
    const kit = musicKitRef.current;
    if (!kit.ctx || !kit.masterGain) return;
    kit.masterGain.gain.setTargetAtTime(music.volume, kit.ctx.currentTime, 0.03);
  }, [music.volume]);

  useEffect(() => {
    const kit = musicKitRef.current;
    if (!music.playing || !kit.ctx || !kit.masterGain) return;
    kit.cleanup?.();
    kit.cleanup = buildMusicGraph(kit.ctx, kit.masterGain, activeMusicPreset);
  }, [activeMusicPreset, music.playing]);

  useEffect(() => {
    const kit = musicKitRef.current;
    return () => {
      kit.cleanup?.();
      if (kit.ctx && kit.ctx.state !== "closed") kit.ctx.close().catch(() => {});
    };
  }, []);

  async function ensureMusicAudio() {
    const kit = musicKitRef.current;
    if (!kit.ctx || !kit.masterGain) {
      const Ctor = audioContextCtor();
      if (!Ctor) return false;
      const ctx = new Ctor();
      const masterGain = new GainNode(ctx, { gain: music.volume });
      masterGain.connect(ctx.destination);
      kit.ctx = ctx;
      kit.masterGain = masterGain;
    }
    if (kit.ctx.state === "suspended") await kit.ctx.resume();
    return true;
  }

  const timerActions = {
    updateSubject(subject: string) {
      setTimer((state) => ({ ...state, subject }));
    },
    updateFocusMinutes(minutes: number) {
      const focusMinutes = clampMinutes(minutes, 25);
      setTimer((state) => ({
        ...state,
        focusMinutes,
        secondsLeft: state.mode === "focus" && !state.running ? focusMinutes * 60 : state.secondsLeft,
      }));
    },
    updateBreakMinutes(minutes: number) {
      const breakMinutes = clampMinutes(minutes, 5);
      setTimer((state) => ({
        ...state,
        breakMinutes,
        secondsLeft: state.mode === "break" && !state.running ? breakMinutes * 60 : state.secondsLeft,
      }));
    },
    start() {
      setTimer((state) => ({
        ...state,
        ringing: false,
        running: true,
        endsAt: Date.now() + Math.max(1, state.secondsLeft) * 1000,
      }));
    },
    pause() {
      setTimer((state) => {
        const secondsLeft = state.endsAt ? Math.max(1, Math.ceil((state.endsAt - Date.now()) / 1000)) : state.secondsLeft;
        return { ...state, secondsLeft, running: false, endsAt: null };
      });
    },
    reset() {
      setTimer((state) => ({
        ...state,
        mode: "focus",
        secondsLeft: state.focusMinutes * 60,
        running: false,
        endsAt: null,
        ringing: false,
      }));
    },
    dismissRing() {
      setTimer((state) => ({ ...state, ringing: false }));
    },
    async toggleNotifications() {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") {
        const result = await Notification.requestPermission();
        setTimer((state) => ({ ...state, notificationsEnabled: result === "granted" }));
        return;
      }
      setTimer((state) => ({ ...state, notificationsEnabled: !state.notificationsEnabled }));
    },
  };

  const musicActions = {
    setPreset(presetId: string) {
      setMusic((state) => ({ ...state, presetId }));
    },
    setVolume(volume: number) {
      setMusic((state) => ({ ...state, volume: Math.min(1, Math.max(0, volume)) }));
    },
    async start(presetId?: string) {
      setMusic((state) => ({ ...state, presetId: presetId ?? state.presetId, playing: true }));
      await ensureMusicAudio();
    },
    stop() {
      const kit = musicKitRef.current;
      kit.cleanup?.();
      kit.cleanup = null;
      setMusic((state) => ({ ...state, playing: false }));
    },
  };

  return {
    timer,
    timerActions,
    music,
    musicActions,
    musicPresets,
    activeMusicPreset,
  };
}

export type PersistentLearningToolsController = ReturnType<typeof usePersistentLearningTools>;

export function FocusTimerWorkspace({ tools }: { tools: PersistentLearningToolsController }) {
  const { timer, timerActions } = tools;
  const percent =
    timer.mode === "focus"
      ? 100 - (timer.secondsLeft / (timer.focusMinutes * 60)) * 100
      : 100 - (timer.secondsLeft / (timer.breakMinutes * 60)) * 100;

  return (
    <main className="bubble-tool-workspace app-scrollbar">
      <section className="bubble-focus-tool">
        <div className="bubble-focus-tool-copy">
          <span>Focus & Productivity</span>
          <h2>Study Timer</h2>
          <p>The timer keeps running while you move through chats, the store, or other tools.</p>
        </div>

        <div className="bubble-timer-card">
          <div className="bubble-timer-mode">
            <Timer size={20} />
            <span>{timer.mode === "focus" ? "Focus time" : "Break time"}</span>
          </div>
          <strong>{formatSeconds(timer.secondsLeft)}</strong>
          <div className="bubble-timer-progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </div>
          <div className="bubble-timer-controls">
            {timer.running ? (
              <button type="button" onClick={timerActions.pause}>
                <Pause size={18} />
                Pause
              </button>
            ) : (
              <button type="button" onClick={timerActions.start}>
                <Play size={18} />
                Start
              </button>
            )}
            <button type="button" onClick={timerActions.reset}>
              <RotateCcw size={18} />
              Reset
            </button>
          </div>
        </div>

        <div className="bubble-focus-settings">
          <label>
            <span>Focus subject</span>
            <input
              value={timer.subject}
              onChange={(event) => timerActions.updateSubject(event.target.value)}
              placeholder="Biology notes, exam prep, essay drafting..."
            />
          </label>
          <label>
            <span>Focus minutes</span>
            <input
              type="number"
              min={1}
              max={180}
              value={timer.focusMinutes}
              onChange={(event) => timerActions.updateFocusMinutes(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Break minutes</span>
            <input
              type="number"
              min={1}
              max={60}
              value={timer.breakMinutes}
              onChange={(event) => timerActions.updateBreakMinutes(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={() => void timerActions.toggleNotifications()}>
            <Bell size={18} />
            {timer.notificationsEnabled ? "Notifications on" : "Enable notifications"}
          </button>
        </div>

        <div className="bubble-focus-stats">
          <article>
            <strong>{timer.completedFocusSessions}</strong>
            <span>focus sessions</span>
          </article>
          <article>
            <strong>{Math.round(timer.totalFocusSeconds / 60)}</strong>
            <span>focus minutes</span>
          </article>
          <article>
            <strong>{timer.subject.trim() || "General"}</strong>
            <span>current focus</span>
          </article>
        </div>
      </section>
    </main>
  );
}
