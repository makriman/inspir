import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Game Arena",
  description: "Choose an installable local strategy game and get a complete, replayable result.",
  alternates: { canonical: "/games" },
};

const games = [
  {
    slug: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    eyebrow: "3 × 3 · quick tactics",
    description: "Read the lines, take the centre, and make three before the local strategy engine does.",
    mark: "×",
    accent: "violet",
  },
  {
    slug: "connect-four",
    name: "Connect Four",
    eyebrow: "7 columns · spatial planning",
    description: "Build threats through a gravity-fed grid and connect four in any direction.",
    mark: "●",
    accent: "amber",
  },
  {
    slug: "chess",
    name: "Chess",
    eyebrow: "64 squares · full rules",
    description: "Play a complete legal game with castling, promotion, draws, and an exact move replay.",
    mark: "♞",
    accent: "cyan",
  },
] as const;

export default function GamesCatalogPage() {
  return (
    <main className="games-catalog" data-testid="games-catalog">
      <nav className="games-topbar" aria-label="Primary">
        <Link className="games-wordmark" href="/">
          inspir
        </Link>
        <span className="games-topbar-label">Game arena</span>
      </nav>

      <section className="games-catalog-hero" aria-labelledby="games-title">
        <p className="games-kicker">Three games. Three installable mini-apps.</p>
        <h1 id="games-title">Think in moves, not loading screens.</h1>
        <p>
          Every opponent runs deterministically on your device. Every finished game gets an exact
          terminal reason, a move-by-move replay, and honest rules provenance.
        </p>
        <div className="games-trust-row" aria-label="Arena properties">
          <span>Local opponent</span>
          <span>No model claims</span>
          <span>Replayable results</span>
        </div>
      </section>

      <section className="games-card-grid" aria-label="Available games">
        {games.map((game, index) => (
          <article className={`games-card games-card--${game.accent}`} key={game.slug}>
            <div className="games-card-index" aria-hidden="true">
              0{index + 1}
            </div>
            <div className="games-card-mark" aria-hidden="true">
              {game.mark}
            </div>
            <p className="games-card-eyebrow">{game.eyebrow}</p>
            <h2>{game.name}</h2>
            <p>{game.description}</p>
            <Link
              className="games-primary-link"
              href={`/games/${game.slug}`}
              data-testid={`open-${game.slug}`}
            >
              Play {game.name}
              <span aria-hidden="true">↗</span>
            </Link>
          </article>
        ))}
      </section>

      <footer className="games-catalog-footer">
        <p>
          Inspired by transparent evaluation arenas: exact identity and replay evidence come before
          a score.
        </p>
        <Link href="/">Return to inspir learning</Link>
      </footer>
    </main>
  );
}
