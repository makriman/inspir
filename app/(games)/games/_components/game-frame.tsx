import Link from "next/link";
import type { ReactNode } from "react";
import { GameInstallSupport } from "./game-install-support";

type GameFrameProps = Readonly<{
  slug: "tic-tac-toe" | "connect-four" | "chess";
  gameName: string;
  mark: string;
  eyebrow: string;
  description: string;
  accent: "violet" | "amber" | "cyan";
  status: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}>;

export function GameFrame({
  slug,
  gameName,
  mark,
  eyebrow,
  description,
  accent,
  status,
  children,
  aside,
}: GameFrameProps) {
  return (
    <main className={`game-shell game-shell--${accent}`} data-game={slug}>
      <nav className="games-topbar" aria-label={`${gameName} navigation`}>
        <Link className="games-wordmark" href="/">
          inspir
        </Link>
        <Link className="games-back-link" href="/games">
          <span aria-hidden="true">←</span> All games
        </Link>
      </nav>

      <header className="game-hero">
        <div className="game-hero-copy">
          <p className="games-kicker">{eyebrow}</p>
          <h1>
            <span className="game-title-mark" aria-hidden="true">
              {mark}
            </span>
            {gameName}
          </h1>
          <p>{description}</p>
        </div>
        <GameInstallSupport gameName={gameName} slug={slug} />
      </header>

      <section className="game-stage" aria-label={`${gameName} game`}>
        <div className="game-main-column">
          <output className="game-status" aria-live="polite" data-testid="game-status">
            {status}
          </output>
          {children}
        </div>

        <aside className="game-side-column" aria-label="Game details">
          {aside}
          <section className="game-provenance-card">
            <p className="game-card-label">Opponent provenance</p>
            <h2>Inspir Local Strategy</h2>
            <dl>
              <div>
                <dt>Type</dt>
                <dd>Deterministic engine</dd>
              </div>
              <div>
                <dt>Runs</dt>
                <dd>On this device</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>1.0.0</dd>
              </div>
            </dl>
            <p className="game-honesty-note">
              This opponent is not an AI model and makes no network call to choose a move.
            </p>
          </section>
        </aside>
      </section>
    </main>
  );
}
