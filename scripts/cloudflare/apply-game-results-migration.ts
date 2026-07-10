import fs from "node:fs";
import path from "node:path";
import {
  D1_DATABASE_NAME,
  cloudflareDir,
  hasFlag,
  resolveBackupDir,
  runWrangler,
} from "./migration-config";

const migrationFile = "drizzle-d1/0012_immutable_game_results.sql";
const expectedColumns = [
  "id",
  "schema_version",
  "game_slug",
  "engine_id",
  "engine_version",
  "terminal_code",
  "winner",
  "outcome",
  "ply_count",
  "payload",
  "started_at",
  "completed_at",
  "duration_ms",
  "created_at",
] as const;

void main();

function main() {
  const remote = hasFlag("--remote");
  if (remote && !hasFlag("--confirm-production")) {
    throw new Error("Remote game-results migration requires --confirm-production.");
  }
  const migrationPath = path.resolve(process.cwd(), migrationFile);
  if (!fs.existsSync(migrationPath)) throw new Error(`Missing migration: ${migrationFile}`);

  const targetFlag = remote ? "--remote" : "--local";
  runWrangler(["d1", "execute", D1_DATABASE_NAME, targetFlag, "--file", migrationPath]);

  const schemaOutput = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    targetFlag,
    "--json",
    "--command",
    `select type, name, tbl_name, sql from sqlite_master where name in ('game_results', 'game_results_reject_update');`,
  ]);
  const columnOutput = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    targetFlag,
    "--json",
    "--command",
    `select name from pragma_table_info('game_results') order by cid;`,
  ]);
  const constraintOutput = runWrangler([
    "d1",
    "execute",
    D1_DATABASE_NAME,
    targetFlag,
    "--json",
    "--command",
    normalizedInvariantQuery(),
  ]);

  const tablePresent = outputHasName(schemaOutput, "game_results");
  const updateGuardPresent = outputHasName(constraintOutput, "game_results_update_guard_verified");
  const schemaVersionFixed = outputHasName(constraintOutput, "game_results_schema_version_1");
  const plyCapPresent = outputHasName(constraintOutput, "game_results_ply_cap_128");
  const payloadJsonChecked = outputHasName(constraintOutput, "game_results_payload_json_checked");
  const completionImmutable = outputHasName(constraintOutput, "game_results_completion_immutable");
  const missingColumns = expectedColumns.filter((column) => !outputHasName(columnOutput, column));
  const ok =
    tablePresent &&
    updateGuardPresent &&
    schemaVersionFixed &&
    plyCapPresent &&
    payloadJsonChecked &&
    completionImmutable &&
    missingColumns.length === 0;
  const scope = remote ? "remote" : "local";
  const report = {
    ok,
    scope,
    database: D1_DATABASE_NAME,
    migration: migrationFile,
    tablePresent,
    updateGuardPresent,
    schemaVersionFixed,
    plyCapPresent,
    payloadJsonChecked,
    completionImmutable,
    expectedColumns,
    missingColumns,
    verifiedAt: new Date().toISOString(),
  };
  const reportPath = path.join(cloudflareDir(resolveBackupDir()), `game-results-migration-${scope}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath }));
  if (!ok) {
    const problems = [
      ...missingColumns.map((column) => `missing column ${column}`),
      ...(tablePresent ? [] : ["missing table"]),
      ...(updateGuardPresent ? [] : ["missing update guard"]),
      ...(schemaVersionFixed ? [] : ["missing schema-version constraint"]),
      ...(plyCapPresent ? [] : ["missing 128-ply constraint"]),
      ...(payloadJsonChecked ? [] : ["missing JSON payload constraint"]),
      ...(completionImmutable ? [] : ["missing completion timestamp constraint"]),
    ];
    throw new Error(`Game-results D1 migration verification failed: ${problems.join(", ")}`);
  }
}

function normalizedInvariantQuery() {
  const normalizedSql =
    "lower(replace(replace(replace(replace(replace(replace(replace(sql, char(9), ''), char(10), ''), char(13), ''), ' ', ''), '`', ''), char(34), ''), '[', ''))";
  return `with definitions as (
    select type, name, tbl_name, ${normalizedSql} as normalized_sql
    from sqlite_master
    where name in ('game_results', 'game_results_reject_update')
  )
  select case when instr(normalized_sql, 'check(schema_version=1)') > 0
    then 'game_results_schema_version_1' else 'invalid_game_results_schema_version' end as name
  from definitions where type = 'table' and name = 'game_results'
  union all
  select case when instr(normalized_sql, 'check(ply_count>=0andply_count<=128)') > 0
    then 'game_results_ply_cap_128' else 'invalid_game_results_ply_cap' end
  from definitions where type = 'table' and name = 'game_results'
  union all
  select case when instr(normalized_sql, 'check(json_valid(payload))') > 0
    then 'game_results_payload_json_checked' else 'invalid_game_results_payload_json' end
  from definitions where type = 'table' and name = 'game_results'
  union all
  select case when instr(normalized_sql, 'check(completed_at=created_at)') > 0
    then 'game_results_completion_immutable' else 'invalid_game_results_completion' end
  from definitions where type = 'table' and name = 'game_results'
  union all
  select case when tbl_name = 'game_results'
      and instr(normalized_sql, 'beforeupdateongame_results') > 0
      and instr(normalized_sql, 'selectraise(abort,') > 0
    then 'game_results_update_guard_verified' else 'invalid_game_results_update_guard' end
  from definitions where type = 'trigger' and name = 'game_results_reject_update';`;
}

function outputHasName(output: string, name: string) {
  return new RegExp(`"name"\\s*:\\s*"${escapeRegExp(name)}"`).test(output);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
