import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NATIVE_ACTIVITY_COMPLETION_CHAT_SQL,
  NATIVE_ACTIVITY_COMPLETION_MESSAGE_SQL,
  NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL,
  NATIVE_QUIZ_COMPLETION_SCORE_SQL,
} from "../lib/free-runtime/protected-ai-api";

const sqliteAvailable = spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status === 0;

test("native activity completion uses one receipt-scoped D1 transaction", () => {
  const source = fs.readFileSync(
    path.resolve("lib/free-runtime/protected-ai-api.ts"),
    "utf8",
  );
  const helperStart = source.indexOf("async function completeActivityRunAtomically(");
  const helperEnd = source.indexOf("async function guardedActivityUpdate(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.equal(helper.match(/env\.DB\.batch<ActivityRunRow>\(statements\)/g)?.length, 1);
  assert.match(helper, /const completionToken = crypto\.randomUUID\(\)/);
  assert.match(helper, /const completionMessageId = crypto\.randomUUID\(\)/);
  assert.match(helper, /NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL/);
  assert.match(helper, /NATIVE_QUIZ_COMPLETION_SCORE_SQL/);
  assert.match(helper, /NATIVE_ACTIVITY_COMPLETION_MESSAGE_SQL/);
  assert.match(helper, /NATIVE_ACTIVITY_COMPLETION_CHAT_SQL/);
  assert.doesNotMatch(helper, /\.run\(\)|insertMessage\(/);

  assert.match(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, /completion_token = \?6/);
  assert.match(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, /completion_message_id = \?7/);
  assert.match(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, /completion_token is null/);
  assert.match(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, /status = 'active'/);
  assert.match(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, /json_extract\(state, '\$\.currentIndex'\) = \?11/);
  assert.match(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, /owned\.user_id = \?12/);
  for (const effect of [
    NATIVE_QUIZ_COMPLETION_SCORE_SQL,
    NATIVE_ACTIVITY_COMPLETION_MESSAGE_SQL,
    NATIVE_ACTIVITY_COMPLETION_CHAT_SQL,
  ]) {
    assert.match(effect, /changes\(\) = 1/);
    assert.match(effect, /completed\.completion_token = \?/);
    assert.match(effect, /completed\.completion_message_id = \?/);
    assert.match(effect, /completed\.status = 'completed'/);
  }

  const quizHandler = source.slice(
    source.indexOf("async function handleQuizAnswer("),
    source.indexOf("async function handleFlashcardsCreate("),
  );
  const flashcardHandler = source.slice(
    source.indexOf("async function handleFlashcardReview("),
    source.indexOf("async function handleAdminDashboard("),
  );
  assert.match(quizHandler, /result\.state\.completed[\s\S]*completeActivityRunAtomically/);
  assert.match(flashcardHandler, /result\.state\.completed[\s\S]*completeActivityRunAtomically/);
  assert.doesNotMatch(quizHandler, /update users set score|insertMessage\(env/);
  assert.doesNotMatch(flashcardHandler, /insertMessage\(env/);
});

test("migration adds nullable unique receipts without replaying historical completions", () => {
  const migration = fs.readFileSync(
    path.resolve("drizzle-d1/0015_atomic_activity_completion.sql"),
    "utf8",
  );
  assert.match(migration, /ADD `completion_token` text/);
  assert.match(migration, /ADD `completion_message_id` text/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS `activity_runs_completion_token_uidx`/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS `activity_runs_completion_message_id_uidx`/);
  assert.doesNotMatch(migration, /UPDATE\s+`?activity_runs`?/i);

  const schema = fs.readFileSync(path.resolve("lib/db/schema.ts"), "utf8");
  assert.match(schema, /completionToken: text\("completion_token"\)/);
  assert.match(schema, /completionMessageId: text\("completion_message_id"\)/);
});

test(
  "SQLite proves completion receipts are exactly once and rollback every effect together",
  () => {
    assert.equal(
      sqliteAvailable,
      true,
      "sqlite3 is required for the mandatory activity-completion transaction proof",
    );
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-activity-completion-"));
    const database = path.join(directory, "activity.sqlite");
    try {
      runSql(database, BASE_SCHEMA_AND_DATA);
      runSql(
        database,
        fs.readFileSync(path.resolve("drizzle-d1/0015_atomic_activity_completion.sql"), "utf8"),
      );

      const legacy = queryOne(
        database,
        "select status, state, score, completed_at, completion_token, completion_message_id from activity_runs where id = 'legacy'",
      );
      assert.deepEqual(legacy, {
        status: "completed",
        state: '{"currentIndex":10,"completed":true}',
        score: 8,
        completed_at: 50,
        completion_token: null,
        completion_message_id: null,
      });

      runCompletionTransaction(
        database,
        completionStatements({
          runId: "quiz-run",
          chatId: "quiz-chat",
          type: "quiz",
          oldIndex: 9,
          state: '{"currentIndex":10,"score":10,"completed":true}',
          score: 10,
          maxScore: 10,
          scoreAward: 10,
          token: "quiz-token-1",
          messageId: "quiz-message-1",
          content: "Quiz complete",
          now: 100,
        }),
      );
      // This is the serialized outcome of a stale retry or concurrent loser.
      runCompletionTransaction(
        database,
        completionStatements({
          runId: "quiz-run",
          chatId: "quiz-chat",
          type: "quiz",
          oldIndex: 9,
          state: '{"currentIndex":10,"score":10,"completed":true}',
          score: 10,
          maxScore: 10,
          scoreAward: 10,
          token: "quiz-token-2",
          messageId: "quiz-message-2",
          content: "Duplicate quiz completion",
          now: 101,
        }),
      );
      // D1 may retry a batch with the exact same bound receipt after a
      // transient/ambiguous attempt. The changes() chain keeps that replay a
      // no-op instead of relying on the message uniqueness error to roll back.
      runCompletionTransaction(
        database,
        completionStatements({
          runId: "quiz-run",
          chatId: "quiz-chat",
          type: "quiz",
          oldIndex: 9,
          state: '{"currentIndex":10,"score":10,"completed":true}',
          score: 10,
          maxScore: 10,
          scoreAward: 10,
          token: "quiz-token-1",
          messageId: "quiz-message-1",
          content: "Exact receipt replay",
          now: 102,
        }),
      );

      assert.deepEqual(
        queryOne(
          database,
          "select status, score, completion_token, completion_message_id, updated_at, completed_at from activity_runs where id = 'quiz-run'",
        ),
        {
          status: "completed",
          score: 10,
          completion_token: "quiz-token-1",
          completion_message_id: "quiz-message-1",
          updated_at: 100,
          completed_at: 100,
        },
      );
      assert.deepEqual(queryOne(database, "select score, updated_at from users where id = 'user-1'"), {
        score: 15,
        updated_at: 100,
      });
      assert.deepEqual(
        queryOne(
          database,
          "select count(*) as messages, min(id) as message_id, json_extract(min(metadata), '$.completionToken') as token from messages where chat_id = 'quiz-chat'",
        ),
        { messages: 1, message_id: "quiz-message-1", token: "quiz-token-1" },
      );
      assert.deepEqual(queryOne(database, "select updated_at from chats where id = 'quiz-chat'"), {
        updated_at: 100,
      });

      runCompletionTransaction(
        database,
        completionStatements({
          runId: "flash-run",
          chatId: "flash-chat",
          type: "flashcards",
          oldIndex: 11,
          state: '{"currentIndex":12,"knownCount":7,"completed":true}',
          score: 7,
          maxScore: 12,
          scoreAward: 0,
          token: "flash-token-1",
          messageId: "flash-message-1",
          content: "Deck complete",
          now: 200,
        }),
      );
      assert.deepEqual(queryOne(database, "select score from users where id = 'user-1'"), { score: 15 });
      assert.deepEqual(
        queryOne(
          database,
          "select status, completion_token, completion_message_id from activity_runs where id = 'flash-run'",
        ),
        {
          status: "completed",
          completion_token: "flash-token-1",
          completion_message_id: "flash-message-1",
        },
      );
      assert.deepEqual(queryOne(database, "select count(*) as messages from messages where chat_id = 'flash-chat'"), {
        messages: 1,
      });
      assert.deepEqual(queryOne(database, "select updated_at from chats where id = 'flash-chat'"), {
        updated_at: 200,
      });

      runSql(
        database,
        `create trigger fail_completion_message before insert on messages
         when new.id = 'rollback-message'
         begin select raise(abort, 'forced completion message failure'); end;`,
      );
      const failed = spawnCompletionTransaction(
        database,
        completionStatements({
          runId: "rollback-run",
          chatId: "rollback-chat",
          type: "quiz",
          oldIndex: 9,
          state: '{"currentIndex":10,"score":4,"completed":true}',
          score: 4,
          maxScore: 10,
          scoreAward: 4,
          token: "rollback-token",
          messageId: "rollback-message",
          content: "Must roll back",
          now: 300,
        }),
      );
      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, /forced completion message failure/);
      assert.deepEqual(
        queryOne(
          database,
          "select status, state, completion_token, completion_message_id, updated_at, completed_at from activity_runs where id = 'rollback-run'",
        ),
        {
          status: "active",
          state: '{"currentIndex":9,"completed":false}',
          completion_token: null,
          completion_message_id: null,
          updated_at: 30,
          completed_at: null,
        },
      );
      assert.deepEqual(queryOne(database, "select score, updated_at from users where id = 'user-1'"), {
        score: 15,
        updated_at: 100,
      });
      assert.deepEqual(queryOne(database, "select updated_at from chats where id = 'rollback-chat'"), {
        updated_at: 30,
      });
      assert.deepEqual(queryOne(database, "select count(*) as messages from messages where id = 'rollback-message'"), {
        messages: 0,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

type CompletionInput = {
  runId: string;
  chatId: string;
  type: "quiz" | "flashcards";
  oldIndex: number;
  state: string;
  score: number;
  maxScore: number;
  scoreAward: number;
  token: string;
  messageId: string;
  content: string;
  now: number;
};

function completionStatements(input: CompletionInput) {
  const statements = [
    bindSql(NATIVE_ACTIVITY_COMPLETION_UPDATE_SQL, [
      input.state,
      input.score,
      input.maxScore,
      input.now,
      input.now,
      input.token,
      input.messageId,
      input.runId,
      input.chatId,
      input.type,
      input.oldIndex,
      "user-1",
    ]),
  ];
  if (input.type === "quiz") {
    statements.push(
      bindSql(NATIVE_QUIZ_COMPLETION_SCORE_SQL, [
        input.scoreAward,
        input.now,
        "user-1",
        input.runId,
        input.chatId,
        input.token,
        input.messageId,
      ]),
    );
  }
  statements.push(
    bindSql(NATIVE_ACTIVITY_COMPLETION_MESSAGE_SQL, [
      input.messageId,
      input.chatId,
      input.content,
      JSON.stringify({ completionToken: input.token }),
      input.now,
      input.runId,
      input.type,
      input.token,
      "user-1",
    ]),
    bindSql(NATIVE_ACTIVITY_COMPLETION_CHAT_SQL, [
      input.now,
      input.chatId,
      "user-1",
      input.runId,
      input.type,
      input.token,
      input.messageId,
    ]),
  );
  return statements;
}

function bindSql(sql: string, values: readonly (string | number | null)[]) {
  return sql.replace(/\?(\d+)/g, (_placeholder, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    assert.ok(index >= 0 && index < values.length, `missing SQL binding ${rawIndex}`);
    return sqlLiteral(values[index] ?? null);
  });
}

function sqlLiteral(value: string | number | null) {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    assert.ok(Number.isSafeInteger(value));
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function runCompletionTransaction(database: string, statements: readonly string[]) {
  const result = spawnCompletionTransaction(database, statements);
  assert.equal(result.status, 0, result.stderr);
}

function spawnCompletionTransaction(database: string, statements: readonly string[]) {
  return spawnSync("sqlite3", [database], {
    encoding: "utf8",
    input: `.bail on\npragma foreign_keys = on;\nbegin immediate;\n${statements.join(";\n")};\ncommit;\n`,
  });
}

function runSql(database: string, sql: string) {
  execFileSync("sqlite3", [database], {
    encoding: "utf8",
    input: `.bail on\npragma foreign_keys = on;\n${sql}\n`,
  });
}

function queryOne(database: string, sql: string): Record<string, unknown> {
  const output = execFileSync("sqlite3", ["-json", database, sql], { encoding: "utf8" });
  const parsed: unknown = JSON.parse(output);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  const row: unknown = parsed[0];
  assert.ok(isRecord(row));
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BASE_SCHEMA_AND_DATA = `
create table users (
  id text primary key not null,
  score integer not null,
  updated_at integer not null
);
create table chats (
  id text primary key not null,
  user_id text not null references users(id) on delete cascade,
  updated_at integer not null
);
create table messages (
  id text primary key not null,
  chat_id text not null references chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata text not null,
  created_at integer not null
);
create table activity_runs (
  id text primary key not null,
  chat_id text not null references chats(id) on delete cascade,
  type text not null,
  status text not null default 'active',
  state text not null,
  score integer,
  max_score integer,
  created_at integer not null,
  updated_at integer not null,
  completed_at integer
);
insert into users values ('user-1', 5, 5);
insert into chats values ('legacy-chat', 'user-1', 5);
insert into chats values ('quiz-chat', 'user-1', 10);
insert into chats values ('flash-chat', 'user-1', 20);
insert into chats values ('rollback-chat', 'user-1', 30);
insert into activity_runs values (
  'legacy', 'legacy-chat', 'quiz', 'completed',
  '{"currentIndex":10,"completed":true}', 8, 10, 1, 50, 50
);
insert into activity_runs values (
  'quiz-run', 'quiz-chat', 'quiz', 'active',
  '{"currentIndex":9,"completed":false}', 9, 10, 10, 10, null
);
insert into activity_runs values (
  'flash-run', 'flash-chat', 'flashcards', 'active',
  '{"currentIndex":11,"completed":false}', 6, 12, 20, 20, null
);
insert into activity_runs values (
  'rollback-run', 'rollback-chat', 'quiz', 'active',
  '{"currentIndex":9,"completed":false}', 3, 10, 30, 30, null
);
`;
