import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NATIVE_ACTIVITY_START_ASSISTANT_MESSAGE_SQL,
  NATIVE_ACTIVITY_START_CHAT_SQL,
  NATIVE_ACTIVITY_START_RUN_SQL,
  NATIVE_ACTIVITY_START_USER_MESSAGE_SQL,
} from "../lib/free-runtime/protected-ai-api";

const sqliteAvailable = spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status === 0;

test("quiz and flashcard starts use one ownership-scoped D1 batch", () => {
  const source = fs.readFileSync(path.resolve("lib/free-runtime/protected-ai-api.ts"), "utf8");
  const helperStart = source.indexOf("async function createActivityRunAtomically(");
  const helperEnd = source.indexOf("async function getOwnedActivityRun(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.equal(helper.match(/env\.DB\.batch<ActivityRunRow>/g)?.length, 1);
  assert.match(helper, /NATIVE_ACTIVITY_START_RUN_SQL/);
  assert.match(helper, /NATIVE_ACTIVITY_START_USER_MESSAGE_SQL/);
  assert.match(helper, /NATIVE_ACTIVITY_START_ASSISTANT_MESSAGE_SQL/);
  assert.match(helper, /NATIVE_ACTIVITY_START_CHAT_SQL/);
  assert.doesNotMatch(helper, /\.run\(\)|insertMessage\(|Promise\.all/);

  assert.match(NATIVE_ACTIVITY_START_RUN_SQL, /owned\.user_id = \?8/);
  assert.match(NATIVE_ACTIVITY_START_RUN_SQL, /not exists \(select 1 from activity_runs existing/);
  for (const effect of [
    NATIVE_ACTIVITY_START_USER_MESSAGE_SQL,
    NATIVE_ACTIVITY_START_ASSISTANT_MESSAGE_SQL,
    NATIVE_ACTIVITY_START_CHAT_SQL,
  ]) {
    assert.match(effect, /changes\(\) = 1/);
  }
  assert.match(NATIVE_ACTIVITY_START_USER_MESSAGE_SQL, /owned\.user_id = \?8/);
  assert.match(NATIVE_ACTIVITY_START_ASSISTANT_MESSAGE_SQL, /owned\.user_id = \?8/);
  assert.match(NATIVE_ACTIVITY_START_CHAT_SQL, /user_id = \?3/);

  const quizHandler = source.slice(
    source.indexOf("async function handleQuizCreate("),
    source.indexOf("async function handleQuizAnswer("),
  );
  const flashHandler = source.slice(
    source.indexOf("async function handleFlashcardsCreate("),
    source.indexOf("async function handleFlashcardReview("),
  );
  for (const handler of [quizHandler, flashHandler]) {
    assert.match(handler, /input\.requestId/);
    assert.match(handler, /getOwnedActivityRun[\s\S]*providerSettings/);
    assert.match(handler, /createActivityRunAtomically/);
    assert.doesNotMatch(handler, /insertMessage\(|Promise\.all/);
  }

  for (const workspace of ["components/chat/QuizWorkspace.tsx", "components/chat/FlashcardWorkspace.tsx"]) {
    const client = fs.readFileSync(path.resolve(workspace), "utf8");
    assert.match(client, /pendingBuildRequest/);
    assert.match(client, /requestId: buildRequest\.requestId/);
    assert.match(client, /pendingBuildRequest\.current = null/);
  }
});

test("SQLite proves activity starts roll back, enforce ownership, and replay without duplicates", () => {
  assert.equal(sqliteAvailable, true, "sqlite3 is required for the activity-start transaction proof");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-activity-start-"));
  const database = path.join(directory, "activity.sqlite");
  try {
    runSql(database, BASE_SCHEMA_AND_DATA);

    runStartTransaction(
      database,
      startStatements({
        runId: "11111111-1111-4111-8111-111111111111",
        chatId: "quiz-chat",
        userId: "user-1",
        type: "quiz",
        state: '{"topic":"Algebra","currentIndex":0,"completed":false}',
        score: 0,
        maxScore: 10,
        userMessageId: "21111111-1111-4111-8111-111111111111",
        assistantMessageId: "31111111-1111-4111-8111-111111111111",
        userContent: "Quiz me on Algebra",
        assistantContent: "Quiz ready",
        now: 100,
      }),
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as runs from activity_runs where chat_id = 'quiz-chat'"),
      { runs: 1 },
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as messages from messages where chat_id = 'quiz-chat'"),
      { messages: 2 },
    );
    assert.deepEqual(queryOne(database, "select title, updated_at from chats where id = 'quiz-chat'"), {
      title: "Quiz me on Algebra",
      updated_at: 101,
    });

    // A retried HTTP request keeps the run id but may allocate fresh transcript
    // ids. The first committed state and transcript must remain authoritative.
    runStartTransaction(
      database,
      startStatements({
        runId: "11111111-1111-4111-8111-111111111111",
        chatId: "quiz-chat",
        userId: "user-1",
        type: "quiz",
        state: '{"topic":"Algebra","currentIndex":0,"completed":false,"retry":true}',
        score: 0,
        maxScore: 10,
        userMessageId: "41111111-1111-4111-8111-111111111111",
        assistantMessageId: "51111111-1111-4111-8111-111111111111",
        userContent: "Duplicate retry",
        assistantContent: "Duplicate assistant",
        now: 200,
      }),
    );
    assert.deepEqual(
      queryOne(database, "select state, updated_at from activity_runs where id = '11111111-1111-4111-8111-111111111111'"),
      { state: '{"topic":"Algebra","currentIndex":0,"completed":false}', updated_at: 100 },
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as messages from messages where chat_id = 'quiz-chat'"),
      { messages: 2 },
    );
    assert.deepEqual(queryOne(database, "select title, updated_at from chats where id = 'quiz-chat'"), {
      title: "Quiz me on Algebra",
      updated_at: 101,
    });

    runStartTransaction(
      database,
      startStatements({
        runId: "61111111-1111-4111-8111-111111111111",
        chatId: "quiz-chat",
        userId: "user-2",
        type: "quiz",
        state: '{"topic":"Unauthorized"}',
        score: 0,
        maxScore: 10,
        userMessageId: "71111111-1111-4111-8111-111111111111",
        assistantMessageId: "81111111-1111-4111-8111-111111111111",
        userContent: "Must not persist",
        assistantContent: "Must not persist",
        now: 300,
      }),
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as runs from activity_runs where id = '61111111-1111-4111-8111-111111111111'"),
      { runs: 0 },
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as messages from messages where created_at >= 300"),
      { messages: 0 },
    );

    runSql(
      database,
      `create trigger fail_activity_start_assistant before insert on messages
       when new.id = 'rollback-assistant'
       begin select raise(abort, 'forced activity start failure'); end;`,
    );
    const rollbackStatements = startStatements({
      runId: "91111111-1111-4111-8111-111111111111",
      chatId: "rollback-chat",
      userId: "user-1",
      type: "flashcards",
      state: '{"topic":"Biology","currentIndex":0,"completed":false}',
      score: 0,
      maxScore: 12,
      userMessageId: "rollback-user",
      assistantMessageId: "rollback-assistant",
      userContent: "Build biology cards",
      assistantContent: "Deck ready",
      now: 400,
    });
    const failed = spawnStartTransaction(database, rollbackStatements);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /forced activity start failure/);
    assert.deepEqual(
      queryOne(database, "select count(*) as runs from activity_runs where chat_id = 'rollback-chat'"),
      { runs: 0 },
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as messages from messages where chat_id = 'rollback-chat'"),
      { messages: 0 },
    );
    assert.deepEqual(queryOne(database, "select title, updated_at from chats where id = 'rollback-chat'"), {
      title: "Untitled",
      updated_at: 30,
    });

    runSql(database, "drop trigger fail_activity_start_assistant;");
    runStartTransaction(database, rollbackStatements);
    assert.deepEqual(
      queryOne(database, "select count(*) as runs from activity_runs where chat_id = 'rollback-chat'"),
      { runs: 1 },
    );
    assert.deepEqual(
      queryOne(database, "select count(*) as messages from messages where chat_id = 'rollback-chat'"),
      { messages: 2 },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

type StartInput = {
  runId: string;
  chatId: string;
  userId: string;
  type: "quiz" | "flashcards";
  state: string;
  score: number;
  maxScore: number;
  userMessageId: string;
  assistantMessageId: string;
  userContent: string;
  assistantContent: string;
  now: number;
};

function startStatements(input: StartInput) {
  return [
    bindSql(NATIVE_ACTIVITY_START_RUN_SQL, [
      input.runId,
      input.chatId,
      input.type,
      input.state,
      input.score,
      input.maxScore,
      input.now,
      input.userId,
    ]),
    bindSql(NATIVE_ACTIVITY_START_USER_MESSAGE_SQL, [
      input.userMessageId,
      input.chatId,
      input.userContent,
      JSON.stringify({ activityRunId: input.runId, event: "started" }),
      input.now,
      input.runId,
      input.type,
      input.userId,
    ]),
    bindSql(NATIVE_ACTIVITY_START_ASSISTANT_MESSAGE_SQL, [
      input.assistantMessageId,
      input.chatId,
      input.assistantContent,
      JSON.stringify({ activityRunId: input.runId, event: "started" }),
      input.now + 1,
      input.runId,
      input.type,
      input.userId,
      input.userMessageId,
    ]),
    bindSql(NATIVE_ACTIVITY_START_CHAT_SQL, [
      input.now + 1,
      input.chatId,
      input.userId,
      input.runId,
      input.type,
      input.userMessageId,
      input.assistantMessageId,
      input.userContent,
    ]),
  ];
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

function runStartTransaction(database: string, statements: readonly string[]) {
  const result = spawnStartTransaction(database, statements);
  assert.equal(result.status, 0, result.stderr);
}

function spawnStartTransaction(database: string, statements: readonly string[]) {
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
  id text primary key not null
);
create table chats (
  id text primary key not null,
  user_id text not null references users(id) on delete cascade,
  title text not null,
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
insert into users values ('user-1');
insert into users values ('user-2');
insert into chats values ('quiz-chat', 'user-1', 'Untitled', 10);
insert into chats values ('rollback-chat', 'user-1', 'Untitled', 30);
`;
