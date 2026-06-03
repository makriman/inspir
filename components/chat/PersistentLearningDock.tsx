"use client";

import { CheckCircle2, Music, Pause, Timer, X } from "lucide-react";
import { formatSeconds } from "@/components/chat/persistent-learning-format";
import type { PersistentLearningToolsController } from "@/components/chat/PersistentLearningTools";

export function PersistentLearningDock({
  tools,
  onOpenTimer,
  onOpenMusic,
}: {
  tools: PersistentLearningToolsController;
  onOpenTimer: () => void;
  onOpenMusic: () => void;
}) {
  const { timer, timerActions, music, musicActions, activeMusicPreset } = tools;
  const showTimer = timer.running || timer.ringing;
  const showMusic = music.playing;

  if (!showTimer && !showMusic) return null;

  return (
    <div className="bubble-persistent-dock" aria-live="polite">
      {showTimer ? (
        <div className={`bubble-dock-item ${timer.ringing ? "is-ringing" : ""}`}>
          <button type="button" onClick={onOpenTimer} className="bubble-dock-main">
            {timer.ringing ? <CheckCircle2 size={18} /> : <Timer size={18} />}
            <span>{timer.ringing ? "Timer done" : formatSeconds(timer.secondsLeft)}</span>
          </button>
          {timer.ringing ? (
            <button type="button" onClick={timerActions.dismissRing} aria-label="Dismiss timer alert">
              <X size={16} />
            </button>
          ) : timer.running ? (
            <button type="button" onClick={timerActions.pause} aria-label="Pause timer">
              <Pause size={16} />
            </button>
          ) : null}
        </div>
      ) : null}
      {showMusic ? (
        <div className="bubble-dock-item">
          <button type="button" onClick={onOpenMusic} className="bubble-dock-main">
            <Music size={18} />
            <span>{activeMusicPreset.name}</span>
          </button>
          <button type="button" onClick={musicActions.stop} aria-label="Stop focus music">
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
