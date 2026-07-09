"use client";

import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import Image from "next/image";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useReducer, useRef, useState } from "react";
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

const defaultFilmSrc = "/media/inspir-learning-film.mp4";
const defaultPosterSrc = "/media/inspir-learning-film-poster.webp";
const defaultCaptionsSrc = "/media/inspir-learning-film.en.vtt";
const defaultChapterTrackSrc = "/media/inspir-learning-film.chapters.vtt";
const fallbackFilmDuration = 31;
const deferredAutoplayDelayMs = 8_000;

type MarketingVideoChapter = {
  title: string;
  start: number;
  end: number;
  text: string;
};

export type MarketingVideoCopy = {
  ariaLabel: string;
  playLabel: string;
  kicker: string;
  captionTitle: string;
  captionText: string;
  chaptersLabel: string;
  transcriptLabel: string;
  nextStepLabel: string;
  nextStepTitle: string;
  nextStepText: string;
  startLearningLabel: string;
  replayLabel: string;
  pauseLabel: string;
  playFilmLabel: string;
  restartLabel: string;
  hideChaptersLabel: string;
  showChaptersLabel: string;
  hideTranscriptLabel: string;
  showTranscriptLabel: string;
  controlsLabel: string;
  progressLabel: string;
  unmuteLabel: string;
  muteLabel: string;
  fullscreenLabel: string;
};

type VideoEngineState = {
  started: boolean;
  playing: boolean;
  muted: boolean;
  ended: boolean;
  ready: boolean;
  chaptersOpen: boolean;
  transcriptOpen: boolean;
  duration: number;
  currentTime: number;
};

const emptyVideoChapters: ReadonlyArray<MarketingVideoChapter> = [];
const defaultVideoCopy: MarketingVideoCopy = {
  ariaLabel: "inspir learning film",
  playLabel: "Play inspir learning preview",
  kicker: "Watch 31s",
  captionTitle: "inspir in motion",
  captionText: "Curiosity, practice, and AI that teaches.",
  chaptersLabel: "Film chapters",
  transcriptLabel: "Transcript",
  nextStepLabel: "Next step",
  nextStepTitle: "Start a live learning session.",
  nextStepText: "Ask your first question and move straight into practice.",
  startLearningLabel: "Start learning",
  replayLabel: "Replay",
  pauseLabel: "Pause film",
  playFilmLabel: "Play film",
  restartLabel: "Restart film",
  hideChaptersLabel: "Hide film chapters",
  showChaptersLabel: "Show film chapters",
  hideTranscriptLabel: "Hide film transcript",
  showTranscriptLabel: "Show film transcript",
  controlsLabel: "Video controls",
  progressLabel: "Video progress",
  unmuteLabel: "Unmute film",
  muteLabel: "Mute film",
  fullscreenLabel: "Open film fullscreen",
};
const initialVideoEngineState: VideoEngineState = {
  started: false,
  playing: false,
  muted: false,
  ended: false,
  ready: false,
  chaptersOpen: false,
  transcriptOpen: false,
  duration: fallbackFilmDuration,
  currentTime: 0,
};
const autoplayVideoEngineState: VideoEngineState = {
  ...initialVideoEngineState,
  started: true,
  playing: true,
  muted: true,
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

function VideoFallbackImage({ poster, autoPlay }: { poster: string; autoPlay: boolean }) {
  return (
    <Image
      className="marketing-video-fallback"
      src={poster}
      alt=""
      aria-hidden="true"
      fill
      sizes="100vw"
      loading={autoPlay ? "eager" : "lazy"}
      fetchPriority={autoPlay ? "high" : "auto"}
      decoding="async"
    />
  );
}

function MarketingVideoFrame({
  videoRef,
  videoSrc,
  poster,
  copy,
  loop,
  muted,
  captionsSrc,
  chapterTrackSrc,
  onReady,
  onDurationChange,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoSrc?: string;
  poster: string;
  copy: MarketingVideoCopy;
  loop: boolean;
  muted: boolean;
  captionsSrc: string;
  chapterTrackSrc?: string;
  onReady: () => void;
  onDurationChange: (video: HTMLVideoElement) => void;
  onTimeUpdate: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
}) {
  return (
    <video
      ref={videoRef}
      className="marketing-video-frame"
      src={videoSrc}
      poster={poster}
      aria-label={copy.ariaLabel}
      loop={loop}
      playsInline
      preload={videoSrc ? "metadata" : "none"}
      muted={muted}
      onLoadedData={onReady}
      onCanPlay={onReady}
      onLoadedMetadata={(event) => onDurationChange(event.currentTarget)}
      onDurationChange={(event) => onDurationChange(event.currentTarget)}
      onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
      onPlay={onPlay}
      onPause={onPause}
      onEnded={onEnded}
    >
      <track kind="captions" src={captionsSrc} srcLang="en" label="English captions" />
      {chapterTrackSrc ? <track kind="chapters" src={chapterTrackSrc} srcLang="en" label="Film chapters" /> : null}
    </video>
  );
}

function MarketingVideoPoster({ copy, onPlay }: { copy: MarketingVideoCopy; onPlay: () => void }) {
  return (
    <button type="button" className="marketing-video-poster" onClick={onPlay} aria-label={copy.playLabel}>
      <span className="marketing-video-kicker">{copy.kicker}</span>
      <span className="marketing-hero-video-play">
        <Play size={26} fill="currentColor" />
      </span>
      <span id="learning-film-caption" className="marketing-video-caption">
        <strong>{copy.captionTitle}</strong>
        <span>{copy.captionText}</span>
      </span>
    </button>
  );
}

function MarketingVideoChapters({
  chapters,
  activeChapter,
  open,
  label,
  onSeekToChapter,
}: {
  chapters: ReadonlyArray<MarketingVideoChapter>;
  activeChapter?: MarketingVideoChapter;
  open: boolean;
  label: string;
  onSeekToChapter: (seconds: number) => void;
}) {
  if (!chapters.length) return null;

  return (
    <div id="learning-film-chapters" className="marketing-video-chapters" aria-label={label} hidden={!open}>
      <span>{activeChapter?.title ?? label}</span>
      <div>
        {chapters.map((chapter) => (
          <button
            key={chapter.title}
            type="button"
            onClick={() => onSeekToChapter(chapter.start)}
            aria-current={activeChapter?.title === chapter.title ? "true" : undefined}
          >
            <small>{formatTime(chapter.start)}</small>
            {chapter.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function MarketingVideoTranscript({
  transcript,
  chapters,
  open,
  label,
  onSeekToChapter,
}: {
  transcript?: string;
  chapters: ReadonlyArray<MarketingVideoChapter>;
  open: boolean;
  label: string;
  onSeekToChapter: (seconds: number) => void;
}) {
  if (!transcript) return null;

  return (
    <aside id="learning-film-transcript" className="marketing-video-transcript" aria-label={label} hidden={!open}>
      <span>{label}</span>
      <p>{transcript}</p>
      {chapters.length ? (
        <div>
          {chapters.map((chapter) => (
            <button key={chapter.title} type="button" onClick={() => onSeekToChapter(chapter.start)}>
              <small>{formatTime(chapter.start)}</small>
              {chapter.title}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function MarketingVideoEndCard({
  copy,
  ended,
  onReplay,
}: {
  copy: MarketingVideoCopy;
  ended: boolean;
  onReplay: () => void;
}) {
  if (!ended) return null;

  return (
    <div className="marketing-video-end-card">
      <span>{copy.nextStepLabel}</span>
      <strong>{copy.nextStepTitle}</strong>
      <p>{copy.nextStepText}</p>
      <div>
        <Link href="/chat/learn-anything">
          {copy.startLearningLabel}
          <ArrowUpRight size={15} />
        </Link>
        <button type="button" onClick={onReplay}>
          {copy.replayLabel}
        </button>
      </div>
    </div>
  );
}

function MarketingVideoControls({
  copy,
  playing,
  muted,
  chaptersOpen,
  transcriptOpen,
  hasTranscript,
  progress,
  progressStyle,
  currentTime,
  duration,
  onTogglePlay,
  onRestart,
  onToggleChapters,
  onToggleTranscript,
  onSeek,
  onToggleMute,
  onFullscreen,
}: {
  copy: MarketingVideoCopy;
  playing: boolean;
  muted: boolean;
  chaptersOpen: boolean;
  transcriptOpen: boolean;
  hasTranscript: boolean;
  progress: number;
  progressStyle: CSSProperties;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onRestart: () => void;
  onToggleChapters: () => void;
  onToggleTranscript: () => void;
  onSeek: (value: string) => void;
  onToggleMute: () => void;
  onFullscreen: () => void;
}) {
  return (
    <div className="marketing-video-controls" aria-label={copy.controlsLabel}>
      <button type="button" onClick={onTogglePlay} aria-label={playing ? copy.pauseLabel : copy.playFilmLabel}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <button type="button" onClick={onRestart} aria-label={copy.restartLabel}>
        <RotateCcw size={17} />
      </button>
      <button
        type="button"
        onClick={onToggleChapters}
        aria-label={chaptersOpen ? copy.hideChaptersLabel : copy.showChaptersLabel}
        aria-expanded={chaptersOpen}
        aria-controls="learning-film-chapters"
      >
        <ListVideo size={18} />
      </button>
      {hasTranscript ? (
        <button
          type="button"
          onClick={onToggleTranscript}
          aria-label={transcriptOpen ? copy.hideTranscriptLabel : copy.showTranscriptLabel}
          aria-expanded={transcriptOpen}
          aria-controls="learning-film-transcript"
        >
          <Captions size={18} />
        </button>
      ) : null}
      <label className="marketing-video-progress">
        <span className="sr-only">{copy.progressLabel}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={(event) => onSeek(event.currentTarget.value)}
          style={progressStyle}
          aria-label={copy.progressLabel}
        />
      </label>
      <span className="marketing-video-time">
        {formatTime(currentTime)}
        <span>/</span>
        {formatTime(duration, { roundUp: true })}
      </span>
      <button type="button" onClick={onToggleMute} aria-label={muted ? copy.unmuteLabel : copy.muteLabel}>
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <button type="button" onClick={onFullscreen} aria-label={copy.fullscreenLabel}>
        <Maximize2 size={17} />
      </button>
    </div>
  );
}

export function MarketingVideoEngine({
  chapters = emptyVideoChapters,
  transcript,
  copy = defaultVideoCopy,
  src = defaultFilmSrc,
  poster = defaultPosterSrc,
  captionsSrc = defaultCaptionsSrc,
  chapterTrackSrc = defaultChapterTrackSrc,
  autoPlay = false,
  loop = false,
}: {
  chapters?: ReadonlyArray<MarketingVideoChapter>;
  transcript?: string;
  copy?: MarketingVideoCopy;
  src?: string;
  poster?: string;
  captionsSrc?: string;
  chapterTrackSrc?: string;
  autoPlay?: boolean;
  loop?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingPlayRef = useRef(false);
  const [videoSrc, setVideoSrc] = useState<string | undefined>(() => (autoPlay ? undefined : src));
  const [
    { started, playing, muted, ended, ready, chaptersOpen, transcriptOpen, duration, currentTime },
    updateVideoState,
  ] = useReducer(videoEngineReducer, autoPlay ? autoplayVideoEngineState : initialVideoEngineState);

  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const progressStyle = { "--video-progress": `${progress}%` } as CSSProperties;
  const activeChapter =
    chapters.find((chapter) => currentTime >= chapter.start && currentTime < chapter.end) ??
    chapters[chapters.length - 1];

  useEffect(() => {
    pendingPlayRef.current = false;

    if (!autoPlay) return undefined;

    const timeoutId = window.setTimeout(() => {
      pendingPlayRef.current = true;
      setVideoSrc(src);
    }, deferredAutoplayDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [autoPlay, src]);

  useEffect(() => {
    if (!videoSrc || !pendingPlayRef.current) return;

    const video = videoRef.current;
    if (!video) return;

    pendingPlayRef.current = false;
    if (autoPlay) video.muted = true;

    const playWhenReady = () => {
      updateVideoState({ started: true, playing: true, ended: false });
      void video.play().catch(() => {
        updateVideoState({ playing: false });
      });
    };

    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      playWhenReady();
      return;
    }

    video.addEventListener("canplay", playWhenReady, { once: true });
    return () => video.removeEventListener("canplay", playWhenReady);
  }, [autoPlay, videoSrc]);

  async function playVideo() {
    const video = videoRef.current;
    if (!video) return;

    if (!videoSrc) {
      pendingPlayRef.current = true;
      setVideoSrc(src);
      updateVideoState({ started: true, playing: true, ended: false, ready: false });
      return;
    }

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
    if (!videoSrc) {
      pendingPlayRef.current = true;
      setVideoSrc(src);
      updateVideoState({ started: true, playing: true, ended: false, ready: false, currentTime: 0 });
      return;
    }
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
      className={`marketing-hero-video ${autoPlay ? "is-autoplay" : ""} ${started ? "is-started" : ""} ${
        playing ? "is-playing" : ""
      } ${ready ? "is-ready" : ""} ${
        chaptersOpen ? "is-chapters-open" : ""
      } ${transcriptOpen ? "is-transcript-open" : ""} ${ended ? "is-ended" : ""}`}
      aria-describedby="learning-film-caption"
    >
      <div
        className="marketing-video-ambient"
        aria-hidden="true"
      />
      <VideoFallbackImage poster={poster} autoPlay={autoPlay} />
      <MarketingVideoFrame
        videoRef={videoRef}
        videoSrc={videoSrc}
        poster={poster}
        copy={copy}
        loop={loop}
        muted={muted}
        captionsSrc={captionsSrc}
        chapterTrackSrc={chapterTrackSrc}
        onReady={() => updateVideoState({ ready: true })}
        onDurationChange={updateDuration}
        onTimeUpdate={(time) => updateVideoState({ currentTime: time })}
        onPlay={() => updateVideoState({ ended: false, playing: true })}
        onPause={() => updateVideoState({ playing: false })}
        onEnded={() => updateVideoState({ playing: false, ended: true })}
      />
      <MarketingVideoPoster copy={copy} onPlay={() => void playVideo()} />
      <MarketingVideoChapters
        chapters={chapters}
        activeChapter={activeChapter}
        open={chaptersOpen}
        label={copy.chaptersLabel}
        onSeekToChapter={seekToChapter}
      />
      <MarketingVideoTranscript
        transcript={transcript}
        chapters={chapters}
        open={transcriptOpen}
        label={copy.transcriptLabel}
        onSeekToChapter={seekToChapter}
      />
      <div className="marketing-video-sheen" aria-hidden="true" />
      <MarketingVideoEndCard copy={copy} ended={ended} onReplay={restartVideo} />
      <MarketingVideoControls
        copy={copy}
        playing={playing}
        muted={muted}
        chaptersOpen={chaptersOpen}
        transcriptOpen={transcriptOpen}
        hasTranscript={Boolean(transcript)}
        progress={progress}
        progressStyle={progressStyle}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={togglePlay}
        onRestart={restartVideo}
        onToggleChapters={() => updateVideoState({ chaptersOpen: !chaptersOpen })}
        onToggleTranscript={() => updateVideoState({ transcriptOpen: !transcriptOpen })}
        onSeek={seek}
        onToggleMute={toggleMute}
        onFullscreen={() => void openFullscreen()}
      />
    </div>
  );
}
