"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";

const filmSrc = "/media/inspir-learning-film.mp4";

export function MarketingVideoEngine() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className={`marketing-hero-video ${playing ? "is-playing" : ""}`}>
      <button
        type="button"
        className="marketing-video-poster"
        onClick={() => setPlaying(true)}
        aria-label="Play inspir learning film"
      >
        <span className="marketing-hero-video-play">
          <Play size={26} fill="currentColor" />
        </span>
        <span className="marketing-video-caption">A short film about learning that feels alive.</span>
      </button>
      {playing ? (
        <>
          <video
            className="marketing-video-frame"
            src={filmSrc}
            aria-label="inspir learning film"
            autoPlay
            controls
            controlsList="nodownload"
            playsInline
            preload="metadata"
          />
          <button
            type="button"
            className="marketing-video-close"
            onClick={() => setPlaying(false)}
            aria-label="Close inspir learning film"
          >
            <X size={18} />
          </button>
        </>
      ) : null}
    </div>
  );
}
