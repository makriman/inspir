import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  TABLE_ORDER,
  PRIMARY_KEY_ORDER,
  commandEnv,
  commandExists,
  createHash,
  getArg,
  hasFlag,
  quoteIdent,
  runWrangler,
  stableStringify,
  type TableName,
} from "./migration-config";
import { DATABASE_CONNECTION_ENV_NAMES } from "./retired-provider-env";
import { writeWriteFreezeEvidenceReport } from "./write-freeze-evidence";

const BACKUP_ROOT = path.resolve(process.cwd(), "../inspirlearning-local-backups");
const DATABASE_ENV_NAMES = [...DATABASE_CONNECTION_ENV_NAMES];
const VECTOR_TABLES = ["user_memories", "chat_memory_summaries", "chat_memory_turns"] as const;

type PgColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  ordinal_position: number;
};

type ChecksumEntry = {
  table: string;
  rows: number;
  sha256: string;
  file: string;
};

type MaxSizeEntry = {
  maxRowBytes: number;
  maxValueBytes: number;
};

loadLocalEnvFiles();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const backupDir = resolveNewBackupDir();
  const databaseUrl = getDatabaseUrl();
  const finalBackup = hasFlag("--final");

  const supabaseDir = ensureDir(path.join(backupDir, "supabase"));
  const canonicalDir = ensureDir(path.join(supabaseDir, "canonical"));
  const vercelDir = ensureDir(path.join(backupDir, "vercel"));
  const envDir = ensureDir(path.join(backupDir, "env"));
  const cloudflareDir = ensureDir(path.join(backupDir, "cloudflare"));
  const checksumDir = ensureDir(path.join(backupDir, "checksums"));

  requireCommand("pg_dump");
  requireCommand("psql");

  const writeFreeze = await writeWriteFreezeEvidenceReport(backupDir, {
    finalBackup,
    env: process.env,
  });
  if (!writeFreeze.ok) {
    throw new Error(
      [
        "Refusing to take final provider backup without write-freeze evidence.",
        ...writeFreeze.problems,
        "For rehearsal backups, omit --final.",
      ].join(" "),
    );
  }

  runProviderCommand("pg_dump", [
    "--schema=public",
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--file",
    path.join(supabaseDir, "schema-public.sql"),
    databaseUrl,
  ]);
  runProviderCommand("pg_dump", [
    "--schema=public",
    "--data-only",
    "--inserts",
    "--no-owner",
    "--no-privileges",
    "--file",
    path.join(supabaseDir, "data-public.sql"),
    databaseUrl,
  ]);

  const columns = readJsonFromPsql<PgColumn[]>(
    databaseUrl,
    `
select coalesce(json_agg(row_to_json(c) order by c.table_name, c.ordinal_position), '[]'::json)
from (
  select table_name, column_name, data_type, udt_name, ordinal_position
  from information_schema.columns
  where table_schema = 'public'
    and table_name in (${TABLE_ORDER.map(sqlString).join(", ")})
) c;
`,
  );

  const columnsByTable = Object.fromEntries(TABLE_ORDER.map((table) => [table, [] as Omit<PgColumn, "table_name">[]]));
  for (const column of columns) {
    if (!isTableName(column.table_name)) continue;
    columnsByTable[column.table_name].push({
      column_name: column.column_name,
      data_type: column.data_type,
      udt_name: column.udt_name,
      ordinal_position: column.ordinal_position,
    });
  }

  const primaryKeys = readPrimaryKeys(databaseUrl);
  const checksums: ChecksumEntry[] = [];
  const tableCounts: Record<string, number> = {};
  const maxSizes: Record<string, MaxSizeEntry> = {};

  for (const table of TABLE_ORDER) {
    const output = path.join(canonicalDir, `${table}.ndjson`);
    copyQueryToFile(
      databaseUrl,
      `
copy (
  select row_to_json(source_row)::text
  from (
    select *
    from public.${quoteIdent(table)}
    order by ${orderByClause(table)}
  ) source_row
) to stdout;
`,
      output,
    );
    const checksum = checksumNdjson(output);
    checksums.push({ table, rows: checksum.rows, sha256: checksum.sha256, file: path.relative(backupDir, output) });
    tableCounts[table] = checksum.rows;
    maxSizes[table] = maxNdjsonSizes(output);
  }

  const vectorExports: Record<string, ChecksumEntry> = {};
  for (const table of VECTOR_TABLES) {
    const output = path.join(supabaseDir, `${table}-vectors.ndjson`);
    const idExpression = table === "chat_memory_summaries" ? "chat_id::text" : "id::text";
    copyQueryToFile(
      databaseUrl,
      `
copy (
  select json_build_object('id', ${idExpression}, 'embedding', embedding::text)::text
  from public.${quoteIdent(table)}
  where embedding is not null
  order by ${orderByClause(table)}
) to stdout;
`,
      output,
    );
    const checksum = checksumNdjson(output);
    vectorExports[table] = {
      table,
      rows: checksum.rows,
      sha256: checksum.sha256,
      file: path.relative(backupDir, output),
    };
  }

  const validation = {
    createdAt: new Date().toISOString(),
    tables: tableCounts,
    columns: columnsByTable,
    primaryKeys,
    vectorExports,
    checksums,
    integrityQueries: readIntegrityQueries(databaseUrl),
    maxSizes,
  };
  writeJson(path.join(supabaseDir, "validation.json"), validation);
  writeJson(path.join(checksumDir, "supabase-table-checksums.json"), checksums);

  snapshotLocalEnvFiles(envDir);
  snapshotSupabaseProjectMetadata(supabaseDir, databaseUrl);
  snapshotVercel(vercelDir, envDir);
  snapshotCloudflare(cloudflareDir);
  writeBackupChecksumManifest(backupDir, path.join(checksumDir, "local-backup-files.sha256"));

  console.log(
    JSON.stringify(
      {
        backupDir,
        finalBackup,
        tables: TABLE_ORDER.length,
        rows: Object.values(tableCounts).reduce((sum, rows) => sum + rows, 0),
        vectorRows: Object.values(vectorExports).reduce((sum, entry) => sum + entry.rows, 0),
      },
      null,
      2,
    ),
  );
}

function resolveNewBackupDir() {
  const explicit = getArg("--backup");
  const backupDir = explicit ? path.resolve(explicit) : path.join(BACKUP_ROOT, `cloudflare-migration-${timestamp()}`);
  if (fs.existsSync(backupDir) && fs.readdirSync(backupDir).length > 0) {
    throw new Error(`Backup directory already exists and is not empty: ${backupDir}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

function getDatabaseUrl() {
  const envName = getArg("--database-url-env");
  const names = envName ? [envName] : DATABASE_ENV_NAMES;
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(
    `Missing Supabase/Postgres connection string. Set one of ${names.join(", ")} before running cf:migration:backup.`,
  );
}

function loadLocalEnvFiles() {
  for (const file of [".env", ".env.local", ".env.production.local", ".env.vercel.production.local", ".dev.vars"]) {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = unquoteEnvValue(rawValue);
    }
  }
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replaceAll("\\n", "\n");
  }
  return trimmed;
}

function readPrimaryKeys(databaseUrl: string) {
  const rows = readJsonFromPsql<Array<{ table_name: string; column_name: string; ordinal_position: number }>>(
    databaseUrl,
    `
select coalesce(json_agg(row_to_json(pk) order by pk.table_name, pk.ordinal_position), '[]'::json)
from (
  select tc.table_name, kcu.column_name, kcu.ordinal_position
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.constraint_type = 'PRIMARY KEY'
    and tc.table_schema = 'public'
    and tc.table_name in (${TABLE_ORDER.map(sqlString).join(", ")})
) pk;
`,
  );
  const primaryKeys = Object.fromEntries(TABLE_ORDER.map((table) => [table, [] as string[]]));
  for (const row of rows) {
    if (isTableName(row.table_name)) primaryKeys[row.table_name].push(row.column_name);
  }
  return primaryKeys;
}

function readIntegrityQueries(databaseUrl: string) {
  return {
    messagesWithoutChat: readCount(
      databaseUrl,
      `select count(*) from public.messages m left join public.chats c on c.id = m.chat_id where m.chat_id is not null and c.id is null`,
    ),
    chatsWithoutUser: readCount(
      databaseUrl,
      `select count(*) from public.chats c left join public.users u on u.id = c.user_id where c.user_id is not null and u.id is null`,
    ),
    aiRunsWithoutChat: readCount(
      databaseUrl,
      `select count(*) from public.ai_runs r left join public.chats c on c.id = r.chat_id where r.chat_id is not null and c.id is null`,
    ),
  };
}

function readCount(databaseUrl: string, sql: string) {
  const output = runPsql(databaseUrl, sql);
  return Number(output.trim() || 0);
}

function copyQueryToFile(databaseUrl: string, sql: string, outputPath: string) {
  const fd = fs.openSync(outputPath, "w", 0o600);
  const errPath = `${outputPath}.err`;
  const errFd = fs.openSync(errPath, "w", 0o600);
  try {
    const result = spawnSync(
      "psql",
      ["--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--dbname", databaseUrl, "--command", sql],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", fd, errFd],
        env: cleanProviderEnv(),
      },
    );
    if (result.status !== 0) {
      const error = fs.existsSync(errPath) ? fs.readFileSync(errPath, "utf8") : "";
      throw new Error(`psql export failed for ${path.basename(outputPath)}:\n${error}`);
    }
  } finally {
    fs.closeSync(fd);
    fs.closeSync(errFd);
  }
  if (fs.statSync(errPath).size === 0) fs.rmSync(errPath);
}

function readJsonFromPsql<T>(databaseUrl: string, sql: string): T {
  const output = runPsql(databaseUrl, sql);
  return JSON.parse(output) as T;
}

function runPsql(databaseUrl: string, sql: string) {
  const result = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      "--dbname",
      databaseUrl,
      "--command",
      sql,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: cleanProviderEnv(),
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.status !== 0) throw new Error(`psql query failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function runProviderCommand(
  command: string,
  args: string[],
  options: { allowFailure?: boolean; stdoutFile?: string; extraEnv?: Record<string, string> } = {},
) {
  const stdoutFd = options.stdoutFile ? fs.openSync(options.stdoutFile, "w", 0o600) : "pipe";
  const errFile = options.stdoutFile ? `${options.stdoutFile}.err` : undefined;
  const stderrFd = errFile ? fs.openSync(errFile, "w", 0o600) : "pipe";
  try {
	    const result = spawnSync(command, args, {
	      cwd: process.cwd(),
	      encoding: "utf8",
	      env: { ...cleanProviderEnv(), ...(options.extraEnv ?? {}) },
      stdio: ["ignore", stdoutFd, stderrFd],
      maxBuffer: 128 * 1024 * 1024,
    });
    if (result.status !== 0 && !options.allowFailure) {
      throw new Error(`${command} failed:\n${result.stderr ?? ""}`);
    }
    if (options.stdoutFile && errFile && fs.existsSync(errFile) && fs.statSync(errFile).size === 0) fs.rmSync(errFile);
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    if (typeof stdoutFd === "number") fs.closeSync(stdoutFd);
    if (typeof stderrFd === "number") fs.closeSync(stderrFd);
  }
}

function snapshotSupabaseProjectMetadata(supabaseDir: string, databaseUrl: string) {
  const projectRef = supabaseProjectRefFromDatabaseUrl(databaseUrl);
  const supabaseCli = process.env.SUPABASE_CLI || "/Users/makriman/.supabase/bin/supabase";
  const command = fs.existsSync(supabaseCli) ? supabaseCli : "supabase";
  if (!fs.existsSync(supabaseCli) && !commandExists("supabase")) {
    fs.writeFileSync(path.join(supabaseDir, "project-cli-unavailable.txt"), "supabase CLI was not available during backup.\n");
    return;
  }

  const listPath = path.join(supabaseDir, "projects-list.json");
  const result = runProviderCommand(command, ["projects", "list", "--output-format", "json"], {
    allowFailure: true,
    stdoutFile: listPath,
    extraEnv: { SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (!result.ok) return;

  const projects = parseJsonFromFile<Array<Record<string, unknown>>>(listPath);
  const project = projects.find((candidate) => candidate.ref === projectRef || candidate.id === projectRef);
  if (!project) {
    writeJson(path.join(supabaseDir, "project.json"), {
      projectRef,
      error: "Supabase project ref was not present in projects-list.json.",
    });
    return;
  }

  writeJson(path.join(supabaseDir, "project.json"), {
    projectRef,
    organizationId: stringValue(project.organization_id),
    organizationSlug: stringValue(project.organization_slug),
    name: stringValue(project.name),
    ref: stringValue(project.ref),
    id: stringValue(project.id),
    region: stringValue(project.region),
    status: stringValue(project.status),
    createdAt: stringValue(project.created_at),
    databaseHost: typeof project.database === "object" && project.database ? stringValue((project.database as Record<string, unknown>).host) : "",
  });
}

function snapshotLocalEnvFiles(envDir: string) {
  const localEnvFiles = [
    ".env",
    ".env.local",
    ".env.production.local",
    ".env.vercel.production.local",
    ".dev.vars",
  ];
  for (const file of localEnvFiles) {
    const source = path.resolve(process.cwd(), file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(envDir, file.replace(/^\./, "dot-")));
  }
}

function snapshotVercel(vercelDir: string, envDir: string) {
  copyIfExists(path.resolve(process.cwd(), "vercel.json"), path.join(vercelDir, "vercel.json"));
  copyIfExists(path.resolve(process.cwd(), ".vercel", "project.json"), path.join(vercelDir, "project.json"));
  copyIfExists(path.resolve(process.cwd(), ".vercel", "output", "config.json"), path.join(vercelDir, "output-config.json"));
  copyIfExists(path.resolve(process.cwd(), ".vercel", "output", "builds.json"), path.join(vercelDir, "output-builds.json"));

  if (!commandExists("vercel")) {
    fs.writeFileSync(path.join(vercelDir, "vercel-cli-unavailable.txt"), "vercel CLI was not available during backup.\n");
    return;
  }

  runProviderCommand("vercel", ["inspect", "inspirlearning.com"], {
    allowFailure: true,
    stdoutFile: path.join(vercelDir, "inspect-inspirlearning.com.txt"),
  });
  runProviderCommand("vercel", ["alias", "ls"], {
    allowFailure: true,
    stdoutFile: path.join(vercelDir, "alias-ls.txt"),
  });
  runProviderCommand("vercel", ["env", "pull", path.join(envDir, "vercel-production-env-pull.local"), "--environment=production", "--yes"], {
    allowFailure: true,
    stdoutFile: path.join(vercelDir, "env-pull.out"),
  });
}

function snapshotCloudflare(cloudflareDir: string) {
  writeWranglerSnapshot(["whoami"], path.join(cloudflareDir, "wrangler-whoami.txt"));
  writeWranglerSnapshot(["d1", "list", "--json"], path.join(cloudflareDir, "d1-list.json"));
  writeWranglerSnapshot(["vectorize", "list"], path.join(cloudflareDir, "vectorize-list.txt"));
  writeWranglerSnapshot(["r2", "bucket", "list"], path.join(cloudflareDir, "r2-list.txt"));
  writeWranglerSnapshot(["queues", "list"], path.join(cloudflareDir, "queues-list.txt"));
  writeWranglerSnapshot(["secret", "list", "--format=json"], path.join(cloudflareDir, "wrangler-secret-list.json"));
}

function writeWranglerSnapshot(args: string[], outputPath: string) {
  try {
    fs.writeFileSync(outputPath, runWrangler(args, { allowFailure: true }), { mode: 0o600 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(`${outputPath}.err`, message, { mode: 0o600 });
  }
}

function checksumNdjson(filePath: string) {
  const hash = createHash();
  let rows = 0;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    hash.update(`${stableStringify(JSON.parse(line))}\n`);
    rows += 1;
  }
  return { rows, sha256: hash.digest("hex") };
}

function maxNdjsonSizes(filePath: string): MaxSizeEntry {
  let maxRowBytes = 0;
  let maxValueBytes = 0;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    maxRowBytes = Math.max(maxRowBytes, Buffer.byteLength(line, "utf8"));
    const row = JSON.parse(line) as Record<string, unknown>;
    for (const value of Object.values(row)) {
      if (value === null || value === undefined) continue;
      maxValueBytes = Math.max(maxValueBytes, Buffer.byteLength(JSON.stringify(value), "utf8"));
    }
  }
  return { maxRowBytes, maxValueBytes };
}

function writeBackupChecksumManifest(backupDir: string, outputPath: string) {
  const lines: string[] = [];
  for (const file of listFiles(backupDir)) {
    if (file === outputPath) continue;
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    lines.push(`${hash}  ${path.relative(backupDir, file)}`);
  }
  fs.writeFileSync(outputPath, `${lines.sort().join("\n")}\n`, { mode: 0o600 });
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function orderByClause(table: TableName) {
  const primaryKeys = PRIMARY_KEY_ORDER[table];
  return primaryKeys.map(quoteIdent).join(", ");
}

function cleanProviderEnv() {
  return commandEnv();
}

function requireCommand(command: string) {
  if (!commandExists(command)) throw new Error(`Required command not found on PATH: ${command}`);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function parseJsonFromFile<T>(filePath: string): T {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const firstJson = [text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  if (firstJson === undefined) throw new Error(`No JSON payload found in ${filePath}`);
  const parsed = JSON.parse(text.slice(firstJson)) as unknown;
  if (Array.isArray(parsed)) return parsed as T;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.projects)) return record.projects as T;
  if (Array.isArray(record.result)) return record.result as T;
  return parsed as T;
}

function supabaseProjectRefFromDatabaseUrl(databaseUrl: string) {
  const match = databaseUrl.match(/(?:db|postgres)\.([a-z0-9]{20})\.supabase\.co/i);
  if (!match?.[1]) throw new Error("Could not derive Supabase project ref from database URL.");
  return match[1];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function copyIfExists(source: string, destination: string) {
  if (!fs.existsSync(source)) return;
  fs.copyFileSync(source, destination);
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function isTableName(value: string): value is TableName {
  return (TABLE_ORDER as readonly string[]).includes(value);
}

function timestamp() {
  const now = new Date();
  const offsetMillis = now.getTimezoneOffset() * 60_000;
  const local = new Date(now.getTime() - offsetMillis).toISOString();
  return local.slice(0, 19).replaceAll("-", "").replace("T", "-").replaceAll(":", "");
}
