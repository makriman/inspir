"use client";

import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";

const filmSrc = "/media/inspir-learning-film.mp4";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export function MarketingVideoEngine() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const progressStyle = { "--video-progress": `${progress}%` } as CSSProperties;

  async function playVideo() {
    const video = videoRef.current;
    if (!video) return;

    setStarted(true);
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  function pauseVideo() {
    videoRef.current?.pause();
    setPlaying(false);
  }

  function togglePlay() {
    if (playing) {
      pauseVideo();
    } else {
      void playVideo();
    }
  }

  function restartVideo() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setCurrentTime(0);
    void playVideo();
  }

  function toggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (videoRef.current) videoRef.current.muted = nextMuted;
  }

  function seek(value: string) {
    const video = videoRef.current;
    const nextProgress = Number(value);
    if (!video || !duration || Number.isNaN(nextProgress)) return;
    const nextTime = (nextProgress / 100) * duration;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  async function openFullscreen() {
    const element = containerRef.current;
    if (!element || document.fullscreenElement) return;
    try {
      await element.requestFullscreen();
    } catch {
      // Fullscreen is optional; the inline player still works when unavailable.
    }
  }

  return (
    <div
      ref={containerRef}
      className={`marketing-hero-video ${started ? "is-started" : ""} ${playing ? "is-playing" : ""}`}
    >
      <video
        ref={videoRef}
        className="marketing-video-frame"
        src={filmSrc}
        aria-label="inspir learning film"
        playsInline
        preload="metadata"
        muted={muted}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className="marketing-video-poster"
        onClick={() => void playVideo()}
        aria-label="Play inspir learning film"
      >
        <span className="marketing-hero-video-play">
          <Play size={26} fill="currentColor" />
        </span>
        <span className="marketing-video-caption">
          <strong>Watch the learning film</strong>
          <span>A short story about curiosity, access, and AI that teaches.</span>
        </span>
      </button>
      <div className="marketing-video-sheen" aria-hidden="true" />
      <div className="marketing-video-controls" aria-label="Video controls">
        <button type="button" onClick={togglePlay} aria-label={playing ? "Pause film" : "Play film"}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button type="button" onClick={restartVideo} aria-label="Restart film">
          <RotateCcw size={17} />
        </button>
        <label className="marketing-video-progress">
          <span className="sr-only">Video progress</span>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onChange={(event) => seek(event.currentTarget.value)}
            style={progressStyle}
            aria-label="Video progress"
          />
        </label>
        <span className="marketing-video-time">
          {formatTime(currentTime)}
          <span>/</span>
          {formatTime(duration)}
        </span>
        <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute film" : "Mute film"}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button type="button" onClick={() => void openFullscreen()} aria-label="Open film fullscreen">
          <Maximize2 size={17} />
        </button>
      </div>
    </div>
  );
}
