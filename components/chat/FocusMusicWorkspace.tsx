"use client";

import { Music, Pause, Play, Volume2 } from "lucide-react";
import type { PersistentLearningToolsController } from "@/components/chat/PersistentLearningTools";

export function FocusMusicWorkspace({ tools }: { tools: PersistentLearningToolsController }) {
  const { music, musicActions, musicPresets: presets, activeMusicPreset } = tools;

  return (
    <main className="inspir-tool-workspace app-scrollbar">
      <section className="inspir-focus-tool">
        <div className="inspir-focus-tool-copy">
          <span>Focus & Productivity</span>
          <h2>Music for Focus</h2>
          <p>Minimal generated audio keeps playing while you keep learning. No embedded player needs to stay open.</p>
        </div>

        <div className="inspir-music-card">
          <div className="inspir-music-now">
            <Music size={24} />
            <div>
              <span>{music.playing ? "Now playing" : "Ready"}</span>
              <strong>{activeMusicPreset.name}</strong>
            </div>
          </div>
          <p>{activeMusicPreset.description}</p>
          <div className="inspir-music-controls">
            {music.playing ? (
              <button type="button" onClick={musicActions.stop}>
                <Pause size={18} />
                Stop
              </button>
            ) : (
              <button type="button" onClick={() => void musicActions.start()}>
                <Play size={18} />
                Play
              </button>
            )}
            <label>
              <Volume2 size={18} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={music.volume}
                onChange={(event) => musicActions.setVolume(Number(event.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="inspir-music-presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                musicActions.setPreset(preset.id);
                if (music.playing) void musicActions.start(preset.id);
              }}
              className={preset.id === music.presetId ? "is-active" : ""}
            >
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
