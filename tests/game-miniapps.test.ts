import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { Chess } from "chess.js";
import {
  applyChessMove,
  createChessState,
  legalChessActions,
} from "../lib/games/chess";
import {
  chooseChessOpponentAction,
  chooseChessOpponentTokenFromPosition,
} from "../lib/games/chess-strategy";
import { applyConnectFourMove, createConnectFourState } from "../lib/games/connect-four";
import { chooseConnectFourOpponentAction } from "../lib/games/connect-four-strategy";
import { applyTicTacToeMove, createTicTacToeState } from "../lib/games/tic-tac-toe";
import { chooseTicTacToeOpponentAction } from "../lib/games/tic-tac-toe-strategy";
import { resultIdFromCreateResponse } from "../app/(games)/games/_components/result-client";

const cwd = process.cwd();
const gameSlugs = ["tic-tac-toe", "connect-four", "chess"] as const;

test("game manifests create three canonical, non-overlapping install identities", () => {
  const ids = new Set<string>();
  const primaryIcons = new Set<string>();
  for (const slug of gameSlugs) {
    const value: unknown = JSON.parse(
      readFileSync(`${cwd}/public/games/${slug}/manifest.webmanifest`, "utf8"),
    );
    assert.ok(isRecord(value));
    assert.equal(value.id, `/games/${slug}`);
    assert.equal(value.scope, `/games/${slug}`);
    assert.equal(value.start_url, `/games/${slug}?source=installed`);
    assert.equal(value.display, "standalone");
    assert.ok(Array.isArray(value.icons));
    assert.equal(value.icons.length, 3);
    const primaryIcon = value.icons[0];
    assert.ok(isRecord(primaryIcon));
    assert.equal(primaryIcon.src, `/games/${slug}/icon.svg`);
    assert.equal(primaryIcon.type, "image/svg+xml");
    assert.ok(existsSync(`${cwd}/public/games/${slug}/icon.svg`));
    primaryIcons.add(String(primaryIcon.src));
    ids.add(String(value.id));
    const serviceWorker = readFileSync(`${cwd}/public/games/${slug}-sw.js`, "utf8");
    assert.match(serviceWorker, /clients\.claim/);
    assert.match(serviceWorker, /cache\.addAll\(SHELL\)/);
    assert.match(serviceWorker, /\/api\/games\/results\//);
    assert.match(serviceWorker, /\/_next\/static\//);
  }
  assert.equal(ids.size, gameSlugs.length);
  assert.equal(primaryIcons.size, gameSlugs.length);
});

test("each game client route imports only its own engine graph", () => {
  const entryBySlug = {
    "tic-tac-toe": "tic-tac-toe/_components/tic-tac-toe-game.tsx",
    "connect-four": "connect-four/_components/connect-four-game.tsx",
    chess: "chess/_components/chess-game.tsx",
  } as const;

  for (const slug of gameSlugs) {
    const source = readFileSync(`${cwd}/app/(games)/games/${entryBySlug[slug]}`, "utf8");
    assert.match(source, new RegExp(`@/lib/games/${slug.replaceAll("-", "-")}`));
    for (const otherSlug of gameSlugs.filter((candidate) => candidate !== slug)) {
      assert.doesNotMatch(source, new RegExp(`@/lib/games/${otherSlug}`));
    }
    assert.doesNotMatch(source, /ChatClient|globals\.css|openai|generateOpenAi/i);
  }

  const sharedResult = readFileSync(
    `${cwd}/app/(games)/games/_components/result-experience.tsx`,
    "utf8",
  );
  assert.doesNotMatch(sharedResult, /@\/lib\/games\/(tic-tac-toe|connect-four|chess)/);
});

test("install registration, result routes, and stable selectors are present", () => {
  const installSource = readFileSync(
    `${cwd}/app/(games)/games/_components/game-install-support.tsx`,
    "utf8",
  );
  assert.match(installSource, /`\/games\/\$\{slug\}-sw\.js`/);
  assert.match(installSource, /scope: `\/games\/\$\{slug\}`/);

  for (const slug of gameSlugs) {
    const resultPage = readFileSync(
      `${cwd}/app/(games)/games/${slug}/results/[resultId]/page.tsx`,
      "utf8",
    );
    assert.match(resultPage, /params: Promise<\{ resultId: string \}>/);
  }

  const resultSource = readFileSync(
    `${cwd}/app/(games)/games/_components/result-experience.tsx`,
    "utf8",
  );
  assert.match(resultSource, /data-testid="result-experience"/);
  assert.match(resultSource, /data-testid="result-terminal-code"/);
  assert.match(resultSource, /data-testid="replay-slider"/);

  const resultClient = readFileSync(
    `${cwd}/app/(games)/games/_components/result-client.ts`,
    "utf8",
  );
  const recovery = readFileSync(
    `${cwd}/app/(games)/games/_components/result-save-recovery.tsx`,
    "utf8",
  );
  assert.match(resultClient, /return localSaved \? \{ id: localId, source: "local" \} : null/);
  assert.doesNotMatch(resultClient, /fetch\(`\/api\/games\/results\/\$\{encodeURIComponent\(resultId\)\}`,[\s\S]{0,180}cache: "no-store"/);
  assert.match(recovery, /data-testid="result-save-recovery"/);
  assert.match(recovery, /Retry save/);
  assert.match(recovery, /Export completed game/);

  const chessGame = readFileSync(
    `${cwd}/app/(games)/games/chess/_components/chess-game.tsx`,
    "utf8",
  );
  assert.match(chessGame, /data-testid="promotion-picker"/);
  assert.match(chessGame, /Promote to \$\{promotionName/);
  assert.doesNotMatch(chessGame, /preferredPromotion/);
});

test("result create responses require the canonical nested result id", () => {
  assert.equal(
    resultIdFromCreateResponse({ result: { id: "gr_0123456789abcdef0123456789abcdef" } }),
    "gr_0123456789abcdef0123456789abcdef",
  );
  assert.equal(resultIdFromCreateResponse({ id: "gr_0123456789abcdef0123456789abcdef" }), null);
  assert.equal(resultIdFromCreateResponse({ result: { id: "not-a-result" } }), null);
});

test("grid strategies are deterministic, legal, and block immediate wins", () => {
  let tic = createTicTacToeState("x");
  const ticHumanOne = applyTicTacToeMove(tic, "human", { index: 0 });
  assert.equal(ticHumanOne.ok, true);
  if (!ticHumanOne.ok) return;
  tic = ticHumanOne.state;
  assert.deepEqual(chooseTicTacToeOpponentAction(tic), { index: 4 });
  const ticLocal = applyTicTacToeMove(tic, "opponent", { index: 4 });
  assert.equal(ticLocal.ok, true);
  if (!ticLocal.ok) return;
  const ticHumanTwo = applyTicTacToeMove(ticLocal.state, "human", { index: 1 });
  assert.equal(ticHumanTwo.ok, true);
  if (!ticHumanTwo.ok) return;
  assert.deepEqual(chooseTicTacToeOpponentAction(ticHumanTwo.state), { index: 2 });

  let connect = createConnectFourState("red");
  const connectHuman = applyConnectFourMove(connect, "human", { column: 0 });
  assert.equal(connectHuman.ok, true);
  if (!connectHuman.ok) return;
  connect = connectHuman.state;
  assert.deepEqual(chooseConnectFourOpponentAction(connect), { column: 3 });
  assert.deepEqual(chooseConnectFourOpponentAction(connect), { column: 3 });
});

test("chess strategy uses the same single-position policy on client and server", () => {
  const initial = createChessState({ humanColor: "w" });
  const humanMove = applyChessMove(initial, "human", { token: "e2e4" });
  assert.equal(humanMove.ok, true);
  if (!humanMove.ok) return;

  const action = chooseChessOpponentAction(humanMove.state);
  assert.ok(action);
  assert.ok(legalChessActions(humanMove.state).some((candidate) => candidate.token === action.token));
  assert.equal(action.token, chooseChessOpponentTokenFromPosition(new Chess(humanMove.state.fen)));
  assert.deepEqual(action, chooseChessOpponentAction(humanMove.state));
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
