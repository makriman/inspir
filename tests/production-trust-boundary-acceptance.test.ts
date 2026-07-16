import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND,
  PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT,
  PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256,
  PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
  PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256,
  createProductionTrustBoundaryAcceptance,
  parseProductionTrustBoundaryAcceptanceCli,
  productionTrustBoundaryAcceptanceBinding,
  readAndValidateProductionTrustBoundaryAcceptance,
} from "../scripts/cloudflare/production-trust-boundary-acceptance";
import {
  TRUST_BOUND_PRODUCTION_COMMANDS,
  parseTrustBoundProductionCommandName,
  runTrustBoundProductionCommand,
} from "../scripts/cloudflare/run-trust-bound-production-command";
import { RELEASE_BACKUP_DIR_ENV } from "../scripts/cloudflare/migration-config";

const ACCEPTED_AT = new Date("2026-07-16T09:00:00.000Z");
const EXPECTED_TRUST_BOUND_PRODUCTION_COMMANDS = [
  "cf:preview:remote",
  "cf:prepare:deploy",
  "cf:deploy",
  "cf:upload-candidate",
  "cf:stage-candidate",
  "cf:verify:candidate-override",
  "cf:activate-candidate",
  "cf:deploy:www-redirect",
  "cf:upload",
  "cf:check:write-freeze",
  "cf:sync:topic-seeds",
  "cf:r2:retire-cache-build",
  "cf:sync:site-translation-sources",
  "cf:d1:repair-seo-translations",
  "cf:d1:reconcile-staged-translations",
  "cf:check:d1-migration-budget",
  "cf:apply:d1-runtime-migrations",
  "cf:apply:d1-runtime-migration-0017",
  "cf:rollback",
  "cf:resolve:production-maintenance",
  "cf:verify:d1-runtime-migrations",
  "cf:verify:d1-runtime-migration-0017",
  "cf:verify:historical-data-preservation",
  "cf:verify:historical-data-fresh-0016-preservation",
  "cf:verify:historical-data-continuity",
  "cf:cutover:historical-data-fresh-0016",
  "cf:preflight:deploy",
  "cf:verify:cloudflare-token",
  "cf:verify:vectorize-readiness",
  "cf:verify:production",
  "cf:verify:authenticated-production",
  "cf:verify:worker-outcomes",
  "cf:verify:background-outcomes",
  "cf:test:e2e:production",
] as const;

test("fresh trust acceptance CLI requires the exact acknowledgement and bounded optional backup", () => {
  assert.deepEqual(
    parseProductionTrustBoundaryAcceptanceCli([
      PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
    ]),
    { backupDirectory: undefined },
  );
  const parsed = parseProductionTrustBoundaryAcceptanceCli([
    "--backup",
    "tmp/evidence",
    PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
  ]);
  assert.equal(parsed.backupDirectory, path.resolve("tmp/evidence"));
  for (const args of [
    [],
    ["--confirm-production"],
    [PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG, "extra"],
    [
      PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
      PRODUCTION_TRUST_BOUNDARY_CONFIRMATION_FLAG,
    ],
    ["--backup"],
  ]) {
    assert.throws(
      () => parseProductionTrustBoundaryAcceptanceCli(args),
      /Trust acceptance/,
    );
  }
});

test("acceptance is private, release-bound, append-only, and exactly reusable", () => {
  const fixture = makeFixture();
  const first = createProductionTrustBoundaryAcceptance({
    ...acceptanceOptions(fixture),
    now: ACCEPTED_AT,
  });
  const firstStat = fs.lstatSync(first.path);
  const second = createProductionTrustBoundaryAcceptance({
    ...acceptanceOptions(fixture),
    now: new Date(ACCEPTED_AT.getTime() + 60_000),
  });
  const secondStat = fs.lstatSync(second.path);

  assert.equal(first.sha256, second.sha256);
  assert.equal(first.path, second.path);
  assert.equal(firstStat.ino, secondStat.ino);
  assert.equal(firstStat.nlink, 1);
  assert.equal(firstStat.mode & 0o777, 0o600);
  assert.equal(fs.lstatSync(path.dirname(first.path)).mode & 0o777, 0o700);
  assert.equal(first.artifact.kind, PRODUCTION_TRUST_BOUNDARY_ACCEPTANCE_KIND);
  assert.equal(first.artifact.exactStatement, PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT);
  assert.equal(
    first.artifact.exactStatementSha256,
    PRODUCTION_TRUST_BOUNDARY_ACCEPTED_STATEMENT_SHA256,
  );
  assert.equal(
    first.artifact.releaseScopeSha256,
    PRODUCTION_TRUST_BOUNDARY_RELEASE_SCOPE_SHA256,
  );
  assert.equal(first.artifact.git.head, first.artifact.git.upstream);
  assert.deepEqual(
    productionTrustBoundaryAcceptanceBinding(first),
    productionTrustBoundaryAcceptanceBinding(second),
  );
});

test("acceptance fails closed for missing, dirty, unpushed, changed, linked, or broad evidence", () => {
  {
    const fixture = makeFixture();
    assert.throws(
      () => readAndValidateProductionTrustBoundaryAcceptance(fixture),
      /missing|mode-0[67]00|owner-only/,
    );
  }
  {
    const fixture = makeFixture();
    assert.throws(
      () =>
        createProductionTrustBoundaryAcceptance({
          ...fixture,
          now: ACCEPTED_AT,
          dependencies: {
            buildSafetyChecks: () => [
              { name: "live preview E2E", status: "fail" },
            ],
          },
        }),
      /fresh passing local release evidence: live preview E2E/,
    );
  }
  {
    const fixture = makeFixture();
    fs.chmodSync(fixture.backupDirectory, 0o755);
    assert.throws(
      () =>
        createProductionTrustBoundaryAcceptance({
          ...acceptanceOptions(fixture),
          now: ACCEPTED_AT,
        }),
      /owner-only mode-0700/,
    );
  }
  {
    const fixture = makeFixture();
    const alias = `${fixture.backupDirectory}-alias`;
    fs.symlinkSync(fixture.backupDirectory, alias);
    assert.throws(
      () =>
        createProductionTrustBoundaryAcceptance({
          ...acceptanceOptions({ ...fixture, backupDirectory: alias }),
          now: ACCEPTED_AT,
        }),
      /real owner-only mode-0700|symlinked directory or ancestor/,
    );
  }
  {
    const fixture = makeFixture();
    fs.writeFileSync(path.join(fixture.cwd, "app.ts"), "export const release = 2;\n");
    assert.throws(
      () => createProductionTrustBoundaryAcceptance({
        ...acceptanceOptions(fixture),
        now: ACCEPTED_AT,
      }),
      /clean Git working tree/,
    );
  }
  {
    const fixture = makeFixture();
    fs.writeFileSync(path.join(fixture.cwd, "app.ts"), "export const release = 2;\n");
    runGit(fixture.cwd, ["add", "app.ts"]);
    runGit(fixture.cwd, ["commit", "-m", "unpushed"]);
    assert.throws(
      () => createProductionTrustBoundaryAcceptance({
        ...acceptanceOptions(fixture),
        now: ACCEPTED_AT,
      }),
      /HEAD to equal|HEAD must equal|pushed upstream|requires HEAD/i,
    );
  }
  {
    const fixture = makeFixture();
    const handle = createProductionTrustBoundaryAcceptance({
      ...acceptanceOptions(fixture),
      now: ACCEPTED_AT,
    });
    fs.chmodSync(handle.path, 0o644);
    assert.throws(
      () => readAndValidateProductionTrustBoundaryAcceptance(fixture),
      /mode-0600|owner-only/,
    );
  }
  {
    const fixture = makeFixture();
    const handle = createProductionTrustBoundaryAcceptance({
      ...acceptanceOptions(fixture),
      now: ACCEPTED_AT,
    });
    const hardlink = `${handle.path}.hardlink`;
    fs.linkSync(handle.path, hardlink);
    assert.throws(
      () => readAndValidateProductionTrustBoundaryAcceptance(fixture),
      /single-link|mode-0600/,
    );
  }
  {
    const fixture = makeFixture();
    const handle = createProductionTrustBoundaryAcceptance({
      ...acceptanceOptions(fixture),
      now: ACCEPTED_AT,
    });
    const original = `${handle.path}.original`;
    fs.renameSync(handle.path, original);
    fs.symlinkSync(original, handle.path);
    assert.throws(
      () => readAndValidateProductionTrustBoundaryAcceptance(fixture),
      /missing|mode-0600/,
    );
  }
  {
    const fixture = makeFixture();
    createProductionTrustBoundaryAcceptance({
      ...acceptanceOptions(fixture),
      now: ACCEPTED_AT,
    });
    assert.throws(
      () =>
        readAndValidateProductionTrustBoundaryAcceptance({
          ...fixture,
          now: new Date(ACCEPTED_AT.getTime() - 1),
        }),
      /future-dated/,
    );
  }
  {
    const fixture = makeFixture();
    createProductionTrustBoundaryAcceptance({
      ...acceptanceOptions(fixture),
      now: ACCEPTED_AT,
    });
    fs.writeFileSync(path.join(fixture.cwd, "app.ts"), "export const release = 3;\n");
    runGit(fixture.cwd, ["add", "app.ts"]);
    runGit(fixture.cwd, ["commit", "-m", "changed-release"]);
    runGit(fixture.cwd, ["push"]);
    assert.throws(
      () => readAndValidateProductionTrustBoundaryAcceptance(fixture),
      /missing|mode-0600/,
    );
  }
  {
    const fixture = makeFixture();
    const handle = createProductionTrustBoundaryAcceptance({
      ...acceptanceOptions(fixture),
      now: ACCEPTED_AT,
    });
    const otherBackup = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "inspir-trust-copy-backup-"),
    );
    const otherCloudflare = path.join(otherBackup, "cloudflare");
    const otherAcceptanceDirectory = path.join(
      otherCloudflare,
      "production-trust-boundary-acceptances",
    );
    fs.mkdirSync(otherCloudflare, { mode: 0o700 });
    fs.mkdirSync(otherAcceptanceDirectory, { mode: 0o700 });
    const copied = path.join(otherAcceptanceDirectory, path.basename(handle.path));
    fs.copyFileSync(handle.path, copied);
    fs.chmodSync(copied, 0o600);
    assert.throws(
      () =>
        readAndValidateProductionTrustBoundaryAcceptance({
          cwd: fixture.cwd,
          backupDirectory: otherBackup,
          now: ACCEPTED_AT,
        }),
      /not bound to the exact current pushed source/,
    );
  }
});

test("the trust-bound runner validates acceptance before any child process", () => {
  const fixture = makeFixture();
  const acceptance = createProductionTrustBoundaryAcceptance({
    ...acceptanceOptions(fixture),
    now: ACCEPTED_AT,
  });
  const events: string[] = [];
  let invoked:
    | Readonly<{ executable: string; args: readonly string[]; cwd: string }>
    | undefined;
  const status = runTrustBoundProductionCommand(
    "cf:verify:production",
    ["--confirm-production"],
    {
      ...fixture,
      dependencies: {
        readAcceptance: () => {
          events.push("acceptance");
          return acceptance;
        },
        run: (input) => {
          events.push("child");
          invoked = input;
          return { status: 7 };
        },
      },
    },
  );
  assert.equal(status, 7);
  assert.deepEqual(events, ["acceptance", "child"]);
  assert.ok(invoked);
  assert.deepEqual(invoked.args.slice(-2), [
    path.join(fixture.cwd, "scripts/cloudflare/verify-production.ts"),
    "--confirm-production",
  ]);

  let childCalled = false;
  assert.throws(
    () =>
      runTrustBoundProductionCommand("cf:verify:production", [], {
        ...fixture,
        dependencies: {
          readAcceptance: () => {
            throw new Error("acceptance absent");
          },
          run: () => {
            childCalled = true;
            return { status: 0 };
          },
        },
      }),
    /acceptance absent/,
  );
  assert.equal(childCalled, false);
});

test("the trust-bound runner strips backup metadata from immutable child commands", () => {
  const fixture = makeFixture();
  const acceptance = createProductionTrustBoundaryAcceptance({
    ...acceptanceOptions(fixture),
    now: ACCEPTED_AT,
  });
  let readBackupDirectory: string | undefined;
  let invoked:
    | Readonly<{
        executable: string;
        args: readonly string[];
        cwd: string;
        env: NodeJS.ProcessEnv;
      }>
    | undefined;
  const status = runTrustBoundProductionCommand(
    "cf:upload",
    ["--backup", fixture.backupDirectory],
    {
      cwd: fixture.cwd,
      dependencies: {
        readAcceptance: (input) => {
          readBackupDirectory = input.backupDirectory;
          return acceptance;
        },
        run: (input) => {
          invoked = input;
          return { status: 0 };
        },
      },
    },
  );

  assert.equal(status, 0);
  assert.equal(readBackupDirectory, fixture.backupDirectory);
  assert.ok(invoked);
  assert.deepEqual(invoked.args.slice(-2), [
    path.join(fixture.cwd, "scripts/cloudflare/run-sanitized-build.ts"),
    "worker-upload-candidate",
  ]);
  assert.equal(invoked.args.includes("--backup"), false);
  assert.equal(invoked.args.includes(fixture.backupDirectory), false);
  assert.equal(invoked.env[RELEASE_BACKUP_DIR_ENV], fixture.backupDirectory);
});

test("every mapped production command has an exact guarded package entry point", () => {
  const packageJson: unknown = JSON.parse(
    fs.readFileSync(path.resolve("package.json"), "utf8"),
  );
  assert.ok(isRecord(packageJson));
  assert.ok(isRecord(packageJson.scripts));
  assert.equal(
    packageJson.scripts["cf:accept:fresh-boundary"],
    "tsx scripts/cloudflare/production-trust-boundary-acceptance.ts",
  );
  assert.deepEqual(
    Object.keys(TRUST_BOUND_PRODUCTION_COMMANDS).sort(),
    [...EXPECTED_TRUST_BOUND_PRODUCTION_COMMANDS].sort(),
  );
  for (const name of Object.keys(TRUST_BOUND_PRODUCTION_COMMANDS)) {
    assert.equal(
      packageJson.scripts[name],
      `tsx scripts/cloudflare/run-trust-bound-production-command.ts ${name}`,
      `${name} must enter through the trust-bound runner`,
    );
    assert.equal(parseTrustBoundProductionCommandName(name), name);
  }
  assert.throws(
    () => parseTrustBoundProductionCommandName("cf:typegen"),
    /Usage/,
  );
});

function makeFixture() {
  const root = fs.realpathSync(os.tmpdir());
  const cwd = fs.mkdtempSync(path.join(root, "inspir-trust-acceptance-repo-"));
  const backupDirectory = fs.mkdtempSync(
    path.join(root, "inspir-trust-acceptance-backup-"),
  );
  runGit(cwd, ["init"]);
  runGit(cwd, ["config", "user.email", "codex-tests@inspirlearning.invalid"]);
  runGit(cwd, ["config", "user.name", "Codex Tests"]);
  fs.writeFileSync(path.join(cwd, ".gitignore"), "tmp/\n");
  fs.writeFileSync(path.join(cwd, "app.ts"), "export const release = 1;\n");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "fixture"]);
  const remote = fs.mkdtempSync(
    path.join(root, "inspir-trust-acceptance-remote-"),
  );
  runGit(remote, ["init", "--bare"]);
  runGit(cwd, ["remote", "add", "origin", remote]);
  runGit(cwd, ["push", "--set-upstream", "origin", "HEAD"]);
  return { cwd, backupDirectory };
}

function acceptanceOptions(fixture: ReturnType<typeof makeFixture>) {
  return {
    ...fixture,
    dependencies: {
      buildSafetyChecks: () => [
        { name: "local build and test gates", status: "pass" as const },
        { name: "source secret scan", status: "pass" as const },
        {
          name: "OpenNext build artifact secret scan",
          status: "pass" as const,
        },
      ],
    },
  };
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  assert.equal(
    result.status,
    0,
    `${result.stderr ?? ""}${result.stdout ?? ""}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
