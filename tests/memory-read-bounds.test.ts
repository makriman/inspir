import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  boundedMemoryProfileCategory,
  boundedMemoryProfileSummary,
  boundedMemorySummaryText,
  MAX_MEMORY_PROFILE_CATEGORY_CHARS,
  MAX_MEMORY_PROFILE_ROWS,
  MAX_MEMORY_PROFILE_SUMMARY_CHARS,
  MAX_MEMORY_SUMMARY_CHARS,
  MAX_MEMORY_SUMMARY_SECTION_ID_CHARS,
  MAX_MEMORY_SUMMARY_SECTION_SOURCE_IDS,
  MAX_MEMORY_SUMMARY_SECTION_SOURCE_ID_CHARS,
  MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS,
  MAX_MEMORY_SUMMARY_SECTIONS,
  MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS,
  NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL,
  NATIVE_BOUNDED_MEMORY_PROFILES_SQL,
  NATIVE_BOUNDED_MEMORY_SECTIONS_SQL,
  parseBoundedMemorySummarySections,
  parseRewritableBoundedMemorySummarySections,
} from "../lib/free-runtime/state-api";

const sqliteAvailable = spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status === 0;

test("every historical memory text read uses the bounded SQL contracts", () => {
  const source = fs.readFileSync(path.resolve("lib/free-runtime/state-api.ts"), "utf8");
  assert.equal(source.match(/prepare\(NATIVE_BOUNDED_MEMORY_SECTIONS_SQL\)/g)?.length, 2);
  assert.equal(source.match(/prepare\(NATIVE_BOUNDED_MEMORY_PROFILES_SQL\)/g)?.length, 1);
  assert.equal(
    source.match(/prepare\(NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL\)/g)?.length,
    1,
  );
  assert.doesNotMatch(
    source,
    /prepare\(\s*`select\s+(?:summary|category)[^`]*from user_memory_(?:profiles|summaries)/i,
  );

  assert.match(
    NATIVE_BOUNDED_MEMORY_PROFILES_SQL,
    new RegExp(`substr\\(category, 1, ${MAX_MEMORY_PROFILE_CATEGORY_CHARS + 1}\\)`),
  );
  assert.match(
    NATIVE_BOUNDED_MEMORY_PROFILES_SQL,
    new RegExp(`substr\\(summary, 1, ${MAX_MEMORY_PROFILE_SUMMARY_CHARS + 1}\\)`),
  );
  assert.match(
    NATIVE_BOUNDED_MEMORY_PROFILES_SQL,
    new RegExp(`limit ${MAX_MEMORY_PROFILE_ROWS + 1}$`),
  );
  for (const query of [
    NATIVE_BOUNDED_MEMORY_SECTIONS_SQL,
    NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL,
  ]) {
    assert.match(
      query,
      new RegExp(`substr\\(sections, 1, ${MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS + 1}\\)`),
    );
    assert.match(query, /where user_id = \?1\s+limit 1$/);
  }
  assert.match(
    NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL,
    new RegExp(`substr\\(summary, 1, ${MAX_MEMORY_SUMMARY_CHARS + 1}\\)`),
  );
});

test("oversized legacy profile and summary rows are truncated before leaving SQLite", () => {
  assert.equal(sqliteAvailable, true, "sqlite3 is required for the memory materialization proof");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-memory-bounds-"));
  const database = path.join(directory, "memory.sqlite");
  try {
    runSql(
      database,
      `create table user_memory_profiles (
         user_id text not null,
         category text not null,
         summary text not null,
         updated_at integer not null,
         primary key (user_id, category)
       );
       create table user_memory_summaries (
         user_id text primary key not null,
         summary text not null,
         sections text not null,
         last_synthesized_at integer not null,
         updated_at integer not null
       );
       with recursive values_to_insert(value) as (
         select 1 union all select value + 1 from values_to_insert where value < 40
       )
       insert into user_memory_profiles (user_id, category, summary, updated_at)
       select
         'user-1',
         printf('category-%02d', value),
         replace(printf('%*s', ${MAX_MEMORY_PROFILE_SUMMARY_CHARS * 5}, ''), ' ', 'p'),
         value
       from values_to_insert;
       insert into user_memory_summaries values (
         'user-1',
         replace(printf('%*s', ${MAX_MEMORY_SUMMARY_CHARS * 5}, ''), ' ', 's'),
         replace(printf('%*s', ${MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS * 3}, ''), ' ', 'j'),
         100,
         101
       );`,
    );

    assert.deepEqual(
      queryOne(
        database,
        "select length(summary) as summaryLength, length(sections) as sectionsLength from user_memory_summaries where user_id = 'user-1'",
      ),
      {
        summaryLength: MAX_MEMORY_SUMMARY_CHARS * 5,
        sectionsLength: MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS * 3,
      },
    );

    const profiles = queryRows(database, bindUserId(NATIVE_BOUNDED_MEMORY_PROFILES_SQL));
    assert.equal(profiles.length, MAX_MEMORY_PROFILE_ROWS + 1);
    for (const profile of profiles) {
      const profileSummary = profile.summary;
      assert.ok(typeof profileSummary === "string");
      assert.ok(profileSummary.length <= MAX_MEMORY_PROFILE_SUMMARY_CHARS + 1);
      assert.equal(
        boundedMemoryProfileSummary(profileSummary)?.length,
        MAX_MEMORY_PROFILE_SUMMARY_CHARS,
      );
    }

    const summary = queryOne(database, bindUserId(NATIVE_BOUNDED_MEMORY_DASHBOARD_SUMMARY_SQL));
    const summaryText = summary.summary;
    const summarySections = summary.sections;
    assert.ok(typeof summaryText === "string");
    assert.ok(typeof summarySections === "string");
    assert.equal(summaryText.length, MAX_MEMORY_SUMMARY_CHARS + 1);
    assert.equal(summarySections.length, MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS + 1);
    assert.equal(boundedMemorySummaryText(summaryText).length, MAX_MEMORY_SUMMARY_CHARS);
    assert.equal(parseBoundedMemorySummarySections(summarySections), null);

    const sectionsOnly = queryOne(database, bindUserId(NATIVE_BOUNDED_MEMORY_SECTIONS_SQL));
    const sectionsOnlyText = sectionsOnly.sections;
    assert.ok(typeof sectionsOnlyText === "string");
    assert.equal(sectionsOnlyText.length, MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS + 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("historical memory response sanitizers cap nested fields and reject unsafe JSON", () => {
  assert.equal(
    boundedMemoryProfileCategory("c".repeat(MAX_MEMORY_PROFILE_CATEGORY_CHARS + 1)),
    null,
  );
  assert.equal(
    boundedMemoryProfileSummary("p".repeat(MAX_MEMORY_PROFILE_SUMMARY_CHARS + 50))?.length,
    MAX_MEMORY_PROFILE_SUMMARY_CHARS,
  );
  assert.equal(
    boundedMemorySummaryText("s".repeat(MAX_MEMORY_SUMMARY_CHARS + 50)).length,
    MAX_MEMORY_SUMMARY_CHARS,
  );
  assert.equal(parseBoundedMemorySummarySections("[not-json"), null);
  assert.equal(
    parseBoundedMemorySummarySections("x".repeat(MAX_MEMORY_SUMMARY_SECTIONS_JSON_CHARS + 1)),
    null,
  );

  const sections = parseBoundedMemorySummarySections(
    JSON.stringify(
      Array.from({ length: MAX_MEMORY_SUMMARY_SECTIONS + 5 }, (_, index) => ({
        id: `section-${index}`,
        title: `Title ${index}`,
        category: "preferences",
        summary: "z".repeat(MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS + 500),
        sourceMemoryIds: Array.from(
          { length: MAX_MEMORY_SUMMARY_SECTION_SOURCE_IDS + 10 },
          (__, sourceIndex) => `memory-${index}-${sourceIndex}`,
        ),
        sourceTurnIds: ["t".repeat(MAX_MEMORY_SUMMARY_SECTION_SOURCE_ID_CHARS + 1), "turn-ok"],
        doNotMention: index === 0,
      })),
    ),
  );
  assert.ok(sections);
  assert.equal(sections.length, MAX_MEMORY_SUMMARY_SECTIONS);
  assert.equal(
    parseRewritableBoundedMemorySummarySections(
      JSON.stringify(
        Array.from({ length: MAX_MEMORY_SUMMARY_SECTIONS + 1 }, (_, index) => ({
          id: `too-many-${index}`,
          title: "Title",
          category: "general",
          summary: "Valid summary",
        })),
      ),
    ),
    null,
  );
  for (const section of sections) {
    assert.ok(section.id.length <= MAX_MEMORY_SUMMARY_SECTION_ID_CHARS);
    assert.equal(section.summary.length, MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS);
    assert.equal(section.sourceMemoryIds?.length, MAX_MEMORY_SUMMARY_SECTION_SOURCE_IDS);
    assert.deepEqual(section.sourceTurnIds, ["turn-ok"]);
  }
  assert.equal(sections[0]?.doNotMention, true);
  assert.equal(
    parseRewritableBoundedMemorySummarySections(
      JSON.stringify([
        {
          id: "truncated-nested-field",
          title: "Title",
          category: "general",
          summary: "z".repeat(MAX_MEMORY_SUMMARY_SECTION_SUMMARY_CHARS + 1),
        },
      ]),
    ),
    null,
  );
});

function bindUserId(sql: string) {
  return sql.replaceAll("?1", "'user-1'");
}

function runSql(database: string, sql: string) {
  execFileSync("sqlite3", [database], {
    encoding: "utf8",
    input: `.bail on\n${sql}\n`,
  });
}

function queryRows(database: string, sql: string) {
  const output = execFileSync("sqlite3", ["-json", database, sql], { encoding: "utf8" });
  const parsed: unknown = JSON.parse(output);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.every(isRecord));
  return parsed;
}

function queryOne(database: string, sql: string) {
  const rows = queryRows(database, sql);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
