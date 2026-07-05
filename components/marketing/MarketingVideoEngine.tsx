"use client";

import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import type { CSSProperties } from "react";
import { useReducer, useRef } from "react";
import {
  ArrowUpRight,
  Captions,
  ListVideo,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

const filmSrc = "/media/inspir-learning-film.mp4";
const captionsSrc = "/media/inspir-learning-film.en.vtt";
const chapterTrackSrc = "/media/inspir-learning-film.chapters.vtt";
const fallbackFilmDuration = 31;

type MarketingVideoChapter = {
  title: string;
  start: number;
  end: number;
  text: string;
};

type VideoEngineState = {
  started: boolean;
  playing: boolean;
  muted: boolean;
  ended: boolean;
  chaptersOpen: boolean;
  transcriptOpen: boolean;
  duration: number;
  currentTime: number;
};

const emptyVideoChapters: ReadonlyArray<MarketingVideoChapter> = [];
const initialVideoEngineState: VideoEngineState = {
  started: false,
  playing: false,
  muted: false,
  ended: false,
  chaptersOpen: false,
  transcriptOpen: false,
  duration: fallbackFilmDuration,
  currentTime: 0,
};

function videoEngineReducer(state: VideoEngineState, nextState: Partial<VideoEngineState>) {
  return { ...state, ...nextState };
}

function formatTime(seconds: number, { roundUp = false } = {}) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const roundedSeconds = roundUp ? Math.ceil(seconds) : Math.floor(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = (roundedSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export function MarketingVideoEngine({
  chapters = emptyVideoChapters,
  transcript,
}: {
  chapters?: ReadonlyArray<MarketingVideoChapter>;
  transcript?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [
    { started, playing, muted, ended, chaptersOpen, transcriptOpen, duration, currentTime },
    updateVideoState,
  ] = useReducer(videoEngineReducer, initialVideoEngineState);

  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const progressStyle = { "--video-progress": `${progress}%` } as CSSProperties;
  const activeChapter =
    chapters.find((chapter) => currentTime >= chapter.start && currentTime < chapter.end) ??
    chapters[chapters.length - 1];

  async function playVideo() {
    const video = videoRef.current;
    if (!video) return;

    try {
      await video.play();
      updateVideoState({ started: true, playing: true, ended: false });
    } catch {
      updateVideoState({ started: false, playing: false });
    }
  }

  function pauseVideo() {
    videoRef.current?.pause();
    updateVideoState({ playing: false });
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
    updateVideoState({ currentTime: 0, ended: false });
    void playVideo();
  }

  function toggleMute() {
    const nextMuted = !muted;
    updateVideoState({ muted: nextMuted });
    if (videoRef.current) videoRef.current.muted = nextMuted;
  }

  function seek(value: string) {
    const video = videoRef.current;
    const nextProgress = Number(value);
    if (!video || !duration || Number.isNaN(nextProgress)) return;
    const nextTime = (nextProgress / 100) * duration;
    video.currentTime = nextTime;
    updateVideoState({ currentTime: nextTime });
  }

  function seekToChapter(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    updateVideoState({ currentTime: seconds, ended: false });
    void playVideo();
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

  function updateDuration(video: HTMLVideoElement) {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      updateVideoState({ duration: video.duration });
    }
  }

  return (
    <div
      ref={containerRef}
      id="learning-film"
      className={`marketing-hero-video ${started ? "is-started" : ""} ${playing ? "is-playing" : ""} ${
        chaptersOpen ? "is-chapters-open" : ""
      } ${transcriptOpen ? "is-transcript-open" : ""} ${ended ? "is-ended" : ""}`}
      aria-describedby="learning-film-caption"
    >
      <video
        className="marketing-video-ambient"
        src={filmSrc}
        aria-hidden="true"
        tabIndex={-1}
        playsInline
        muted
        autoPlay
        loop
        preload="metadata"
      />
      <video
        ref={videoRef}
        className="marketing-video-frame"
        src={filmSrc}
        poster="/inspir-social-preview.png"
        aria-label="inspir learning film"
        playsInline
        preload="metadata"
        muted={muted}
        onLoadedMetadata={(event) => updateDuration(event.currentTarget)}
        onDurationChange={(event) => updateDuration(event.currentTarget)}
        onTimeUpdate={(event) => updateVideoState({ currentTime: event.currentTarget.currentTime })}
        onPlay={() => {
          updateVideoState({ ended: false, playing: true });
        }}
        onPause={() => updateVideoState({ playing: false })}
        onEnded={() => {
          updateVideoState({ playing: false, ended: true });
        }}
      >
        <track kind="captions" src={captionsSrc} srcLang="en" label="English captions" />
        <track kind="chapters" src={chapterTrackSrc} srcLang="en" label="Film chapters" />
      </video>
      <button
        type="button"
        className="marketing-video-poster"
        onClick={() => void playVideo()}
        aria-label="Play inspir learning preview"
      >
        <span className="marketing-video-kicker">Watch 31s</span>
        <span className="marketing-hero-video-play">
          <Play size={26} fill="currentColor" />
        </span>
        <span id="learning-film-caption" className="marketing-video-caption">
          <strong>inspir in motion</strong>
          <span>Curiosity, practice, and AI that teaches.</span>
        </span>
      </button>
      {chapters.length ? (
        <div
          id="learning-film-chapters"
          className="marketing-video-chapters"
          aria-label="Film chapters"
          hidden={!chaptersOpen}
        >
          <span>{activeChapter?.title ?? "Film chapters"}</span>
          <div>
            {chapters.map((chapter) => (
              <button
                key={chapter.title}
                type="button"
                onClick={() => seekToChapter(chapter.start)}
                aria-current={activeChapter?.title === chapter.title ? "true" : undefined}
              >
                <small>{formatTime(chapter.start)}</small>
                {chapter.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {transcript ? (
        <aside
          id="learning-film-transcript"
          className="marketing-video-transcript"
          aria-label="Film transcript"
          hidden={!transcriptOpen}
        >
          <span>Transcript</span>
          <p>{transcript}</p>
          {chapters.length ? (
            <div>
              {chapters.map((chapter) => (
                <button key={chapter.title} type="button" onClick={() => seekToChapter(chapter.start)}>
                  <small>{formatTime(chapter.start)}</small>
                  {chapter.title}
                </button>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
      <div className="marketing-video-sheen" aria-hidden="true" />
      {ended ? (
        <div className="marketing-video-end-card">
          <span>Next step</span>
          <strong>Start a live learning session.</strong>
          <p>Ask your first question and move straight into practice.</p>
          <div>
            <Link href="/chat/learn-anything">
              Start learning
              <ArrowUpRight size={15} />
            </Link>
            <button type="button" onClick={restartVideo}>
              Replay
            </button>
          </div>
        </div>
      ) : null}
      <div className="marketing-video-controls" aria-label="Video controls">
        <button type="button" onClick={togglePlay} aria-label={playing ? "Pause film" : "Play film"}>
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button type="button" onClick={restartVideo} aria-label="Restart film">
          <RotateCcw size={17} />
        </button>
        <button
          type="button"
          onClick={() => updateVideoState({ chaptersOpen: !chaptersOpen })}
          aria-label={chaptersOpen ? "Hide film chapters" : "Show film chapters"}
          aria-expanded={chaptersOpen}
          aria-controls="learning-film-chapters"
        >
          <ListVideo size={18} />
        </button>
        {transcript ? (
          <button
            type="button"
            onClick={() => updateVideoState({ transcriptOpen: !transcriptOpen })}
            aria-label={transcriptOpen ? "Hide film transcript" : "Show film transcript"}
            aria-expanded={transcriptOpen}
            aria-controls="learning-film-transcript"
          >
            <Captions size={18} />
          </button>
        ) : null}
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
          {formatTime(duration, { roundUp: true })}
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
