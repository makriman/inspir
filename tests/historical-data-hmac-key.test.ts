import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  HISTORICAL_DATA_HMAC_KEYCHAIN_SERVICE,
  HISTORICAL_DATA_SECURITY_EXECUTABLE,
  createHistoricalDataHmacKey,
  historicalDataHmacKeyId,
  readHistoricalDataHmacKey,
  resolveHistoricalDataLoginKeychainPath,
  requireHistoricalHmacSecret,
  runHistoricalDataSecurityCommand,
  storeHistoricalDataHmacKey,
  type HistoricalDataSecurityCommand,
  type HistoricalDataSecurityCommandResult,
  type HistoricalDataSecurityRunner,
} from "../scripts/cloudflare/historical-data-hmac-key";

const generatedBytes = new Uint8Array(32).fill(0x1a);
const generatedSecret = "1a".repeat(32);
const generatedKeyId = historicalDataHmacKeyId(generatedSecret);
const fakeKeychainRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "inspir-hmac-fake-keychain-"),
);
const loginKeychain = path.join(fakeKeychainRoot, "login.keychain-db");
const otherKeychain = path.join(fakeKeychainRoot, "other.keychain-db");
fs.writeFileSync(loginKeychain, "fake-login-keychain", { mode: 0o600 });
fs.writeFileSync(otherKeychain, "fake-other-keychain", { mode: 0o600 });
const canonicalLoginKeychain = fs.realpathSync.native(loginKeychain);
after(() => {
  fs.rmSync(fakeKeychainRoot, { recursive: true, force: true });
});

test("creates a non-overwriting Keychain item and verifies its readback", async () => {
  const calls: HistoricalDataSecurityCommand[] = [];
  let storedSecret: string | undefined;
  const runner = withKeychainMetadata((command) => {
    calls.push(command);
    if (command.args[0] === "add-generic-password") {
      assert.equal(storedSecret, undefined);
      assert.equal(command.input, `${generatedSecret}\n${generatedSecret}\n`);
      storedSecret = generatedSecret;
      return Promise.resolve(securityResult({ status: 0 }));
    }
    if (storedSecret === undefined) {
      return Promise.resolve(securityResult({ status: 44 }));
    }
    return Promise.resolve(
      securityResult({ status: 0, stdout: `${storedSecret}\n` }),
    );
  }, calls);

  const key = await createHistoricalDataHmacKey({
    platform: "darwin",
    randomBytesProvider: () => generatedBytes,
    runner,
  });

  assert.deepEqual(key, { hmacKeyId: generatedKeyId, secret: generatedSecret });
  assert.equal(calls.length, 15);
  assert.deepEqual(calls[0]?.args, ["login-keychain"]);
  assert.deepEqual(calls[1]?.args, ["default-keychain", "-d", "user"]);
  assert.deepEqual(calls[2]?.args, ["list-keychains", "-d", "user"]);
  assert.deepEqual(calls[3]?.args, ["show-keychain-info", canonicalLoginKeychain]);
  const add = calls.find((call) => call.args[0] === "add-generic-password");
  assert.ok(add);
  assert.equal(add.args.at(-1), "-w");
  assert.equal(add.input, `${generatedSecret}\n${generatedSecret}\n`);
  assert.equal(add.args.includes("-A"), false);
  assert.equal(add.args.includes("-U"), false);
  assert.deepEqual(
    add.args.slice(add.args.indexOf("-T"), add.args.indexOf("-T") + 2),
    ["-T", HISTORICAL_DATA_SECURITY_EXECUTABLE],
  );
  for (const call of calls) {
    assert.equal(call.args.includes(generatedSecret), false);
    assert.equal(call.args.includes(`${generatedSecret}\n`), false);
    if (
      call.args[0] === "add-generic-password" ||
      call.args[0] === "find-generic-password"
    ) {
      assert.ok(call.args.includes(HISTORICAL_DATA_HMAC_KEYCHAIN_SERVICE));
      assert.ok(call.args.includes(generatedKeyId));
    }
    if (call.args[0] === "find-generic-password") {
      assert.equal(call.args.at(-1), canonicalLoginKeychain);
    }
    if (call !== add) assert.equal(call.input, "");
  }
});

test("refuses to overwrite an existing Keychain identity", async () => {
  const calls: HistoricalDataSecurityCommand[] = [];
  const runner = withKeychainMetadata((command) => {
    calls.push(command);
    return Promise.resolve(
      securityResult({ status: 0, stdout: `${generatedSecret}\n` }),
    );
  }, calls);
  await assert.rejects(
    createHistoricalDataHmacKey({
      platform: "darwin",
      randomBytesProvider: () => generatedBytes,
      runner,
    }),
    /already exists; refusing overwrite/,
  );
  assert.equal(calls.length, 5);
  assert.equal(calls[0]?.args[0], "login-keychain");
  assert.equal(calls[4]?.args[0], "find-generic-password");
});

test("idempotently escrows an exact recovered key but never substitutes another key", async () => {
  const existing = await storeHistoricalDataHmacKey(
    generatedSecret,
    generatedKeyId,
    {
      platform: "darwin",
      runner: withKeychainMetadata(() => Promise.resolve(
        securityResult({ status: 0, stdout: `${generatedSecret}\n` }),
      )),
    },
  );
  assert.deepEqual(existing, {
    hmacKeyId: generatedKeyId,
    secret: generatedSecret,
  });

  let calls = 0;
  await assert.rejects(
    storeHistoricalDataHmacKey("2b".repeat(32), generatedKeyId, {
      platform: "darwin",
      runner: () => {
        calls += 1;
        return Promise.resolve(securityResult({ status: 44 }));
      },
    }),
    /does not match the expected identity/,
  );
  assert.equal(calls, 0);
});

test("retrieves only an exact generated secret whose key ID matches", async () => {
  const runner = withKeychainMetadata(() => Promise.resolve(
    securityResult({ status: 0, stdout: `${generatedSecret}\n` }),
  ));
  assert.deepEqual(
    await readHistoricalDataHmacKey(generatedKeyId, {
      platform: "darwin",
      runner,
    }),
    { hmacKeyId: generatedKeyId, secret: generatedSecret },
  );

  const otherSecret = "2b".repeat(32);
  await assert.rejects(
    readHistoricalDataHmacKey(generatedKeyId, {
      platform: "darwin",
      runner: withKeychainMetadata(() => Promise.resolve(
        securityResult({ status: 0, stdout: otherSecret }),
      )),
    }),
    /does not match the requested Keychain identity/,
  );
});

test("rejects missing, malformed, multiline, or inaccessible Keychain values", async () => {
  const cases: Array<{
    name: string;
    result: HistoricalDataSecurityCommandResult;
    expected: RegExp;
  }> = [
    {
      name: "missing",
      result: securityResult({ status: 44 }),
      expected: /absent from Keychain/,
    },
    {
      name: "short",
      result: securityResult({ status: 0, stdout: "a".repeat(63) }),
      expected: /invalid format/,
    },
    {
      name: "uppercase",
      result: securityResult({ status: 0, stdout: "AB".repeat(32) }),
      expected: /invalid format/,
    },
    {
      name: "multiline",
      result: securityResult({
        status: 0,
        stdout: `${generatedSecret}\nextra\n`,
      }),
      expected: /invalid format/,
    },
    {
      name: "denied",
      result: securityResult({ status: 1, stdout: generatedSecret }),
      expected: /Unable to read/,
    },
    {
      name: "signal",
      result: securityResult({
        status: null,
        signal: "SIGTERM",
        stdout: generatedSecret,
      }),
      expected: /Unable to read/,
    },
    {
      name: "timeout",
      result: securityResult({
        status: null,
        timedOut: true,
        stdout: generatedSecret,
      }),
      expected: /Unable to read/,
    },
    {
      name: "output limit",
      result: securityResult({
        status: null,
        outputLimitExceeded: true,
        stdout: generatedSecret,
      }),
      expected: /Unable to read/,
    },
    {
      name: "spawn failure",
      result: securityResult({
        status: null,
        failedToStart: true,
        stdout: generatedSecret,
      }),
      expected: /Unable to read/,
    },
  ];
  for (const scenario of cases) {
    await assert.rejects(
      readHistoricalDataHmacKey(generatedKeyId, {
        platform: "darwin",
        runner: withKeychainMetadata(() => Promise.resolve(scenario.result)),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error, scenario.name);
        assert.match(error.message, scenario.expected, scenario.name);
        assert.doesNotMatch(
          error.message,
          new RegExp(generatedSecret),
          scenario.name,
        );
        return true;
      },
    );
  }
});

test("fails closed before storage on uncertain absence and sanitizes command output", async () => {
  for (const result of [
    securityResult({ status: 1, stdout: generatedSecret }),
    securityResult({
      status: null,
      signal: "SIGKILL",
      stdout: generatedSecret,
    }),
    securityResult({ status: null, timedOut: true, stdout: generatedSecret }),
    securityResult({
      status: null,
      outputLimitExceeded: true,
      stdout: generatedSecret,
    }),
    securityResult({
      status: null,
      failedToStart: true,
      stdout: generatedSecret,
    }),
  ]) {
    let calls = 0;
    await assert.rejects(
      createHistoricalDataHmacKey({
        platform: "darwin",
        randomBytesProvider: () => generatedBytes,
        runner: withKeychainMetadata(() => {
          calls += 1;
          return Promise.resolve(result);
        }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Unable to prove/);
        assert.doesNotMatch(error.message, new RegExp(generatedSecret));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("fails closed when storage or readback is indeterminate", async () => {
  let call = 0;
  await assert.rejects(
    createHistoricalDataHmacKey({
      platform: "darwin",
      randomBytesProvider: () => generatedBytes,
      runner: withKeychainMetadata(() => {
        call += 1;
        if (call === 1) {
          return Promise.resolve(securityResult({ status: 44 }));
        }
        if (call === 2) {
          return Promise.resolve(
            securityResult({ status: 1, stdout: generatedSecret }),
          );
        }
        return Promise.resolve(securityResult({ status: 44 }));
      }),
    }),
    /Unable to store/,
  );

  call = 0;
  await assert.rejects(
    createHistoricalDataHmacKey({
      platform: "darwin",
      randomBytesProvider: () => generatedBytes,
      runner: withKeychainMetadata(() => {
        call += 1;
        if (call === 1) {
          return Promise.resolve(securityResult({ status: 44 }));
        }
        if (call === 2) {
          return Promise.resolve(securityResult({ status: 0 }));
        }
        return Promise.resolve(securityResult({ status: 44 }));
      }),
    }),
    /readback did not match/,
  );
});

test("accepts an ambiguous add only after an exact same-key readback", async () => {
  let call = 0;
  const stored = await createHistoricalDataHmacKey({
    platform: "darwin",
    randomBytesProvider: () => generatedBytes,
    runner: withKeychainMetadata(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(securityResult({ status: 44 }));
      }
      if (call === 2) {
        return Promise.resolve(
          securityResult({
            status: null,
            timedOut: true,
            stdout: generatedSecret,
          }),
        );
      }
      return Promise.resolve(
        securityResult({ status: 0, stdout: `${generatedSecret}\n` }),
      );
    }),
  });
  assert.deepEqual(stored, {
    hmacKeyId: generatedKeyId,
    secret: generatedSecret,
  });
});

test("requires the default and login Keychains to match before adding", async () => {
  let call = 0;
  const runner: HistoricalDataSecurityRunner = (command) => {
    if (command.args[0] === "login-keychain") {
      return Promise.resolve(securityResult({
        status: 0,
        stdout: `    "${loginKeychain}"\n`,
      }));
    }
    if (command.args[0] === "default-keychain") {
      return Promise.resolve(securityResult({
        status: 0,
        stdout: `    "${otherKeychain}"\n`,
      }));
    }
    call += 1;
    if (call === 1) {
      return Promise.resolve(securityResult({ status: 44 }));
    }
    throw new Error("add must not run");
  };
  await assert.rejects(
    createHistoricalDataHmacKey({
      platform: "darwin",
      randomBytesProvider: () => generatedBytes,
      runner,
    }),
    /login Keychain to be the default Keychain/,
  );
  assert.equal(call, 0);
});

test("rejects unsupported platforms, invalid IDs, and invalid random output before Keychain use", async () => {
  let calls = 0;
  const runner: HistoricalDataSecurityRunner = () => {
    calls += 1;
    return Promise.resolve(securityResult({ status: 44 }));
  };
  await assert.rejects(
    readHistoricalDataHmacKey(generatedKeyId, { platform: "linux", runner }),
    /requires the macOS Keychain/,
  );
  await assert.rejects(
    readHistoricalDataHmacKey("not-a-key-id", {
      platform: "darwin",
      runner,
    }),
    /lowercase SHA-256/,
  );
  await assert.rejects(
    createHistoricalDataHmacKey({
      platform: "darwin",
      randomBytesProvider: () => new Uint8Array(31),
      runner,
    }),
    /wrong byte length/,
  );
  assert.equal(calls, 0);
});

test("pure secret validation remains compatible with deterministic core tests", () => {
  assert.equal(
    requireHistoricalHmacSecret("x".repeat(32)),
    "x".repeat(32),
  );
  assert.equal(requireHistoricalHmacSecret("x".repeat(512)).length, 512);
  assert.throws(() => requireHistoricalHmacSecret("x".repeat(31)), /32 to 512/);
  assert.throws(() => requireHistoricalHmacSecret("x".repeat(513)), /32 to 512/);
});

test("login Keychain resolution binds effective login, user default, search list, and file identity", async () => {
  const calls: HistoricalDataSecurityCommand[] = [];
  const resolved = await resolveHistoricalDataLoginKeychainPath(
    withKeychainMetadata(() => {
      throw new Error("No item operation should run during Keychain resolution.");
    }, calls),
  );
  assert.equal(resolved, canonicalLoginKeychain);
  assert.deepEqual(calls.map((call) => call.args), [
    ["login-keychain"],
    ["default-keychain", "-d", "user"],
    ["list-keychains", "-d", "user"],
    ["show-keychain-info", canonicalLoginKeychain],
  ]);
});

test("real security CLI completes an isolated disposable-Keychain round trip", {
  skip: process.platform !== "darwin",
  timeout: 45_000,
}, () => {
  const temporaryHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-hmac-real-keychain-"),
  );
  const keychainDirectory = path.join(
    temporaryHome,
    "Library",
    "Keychains",
  );
  const preferenceDirectory = path.join(
    temporaryHome,
    "Library",
    "Preferences",
  );
  const keychain = path.join(keychainDirectory, "login.keychain-db");
  const temporaryPassword = "inspir-disposable-keychain-test";
  const environment = {
    ...process.env,
    HOME: temporaryHome,
  };
  fs.mkdirSync(keychainDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(preferenceDirectory, { recursive: true, mode: 0o700 });

  const security = (...args: string[]) => spawnSync(
    HISTORICAL_DATA_SECURITY_EXECUTABLE,
    args,
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    },
  );
  const requireSecuritySuccess = (args: string[]) => {
    const result = security(...args);
    assert.equal(
      result.status,
      0,
      `Disposable Keychain setup failed for ${args[0] ?? "unknown"}.`,
    );
  };

  try {
    requireSecuritySuccess(["create-keychain", "-p", temporaryPassword, keychain]);
    requireSecuritySuccess(["unlock-keychain", "-p", temporaryPassword, keychain]);
    requireSecuritySuccess(["set-keychain-settings", "-lut", "3600", keychain]);
    requireSecuritySuccess(["list-keychains", "-d", "user", "-s", keychain]);
    requireSecuritySuccess(["default-keychain", "-d", "user", "-s", keychain]);

    const modulePath = path.join(
      process.cwd(),
      "scripts/cloudflare/historical-data-hmac-key.ts",
    );
    const childScript = [
      `const module = await import(${JSON.stringify(modulePath)});`,
      "const created = await module.createHistoricalDataHmacKey();",
      "const readback = await module.readHistoricalDataHmacKey(created.hmacKeyId);",
      "if (readback.secret !== created.secret) throw new Error('Keychain round-trip mismatch.');",
      "process.stdout.write('actual-security-roundtrip-ok\\n');",
    ].join("\n");
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", childScript],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      },
    );
    assert.equal(child.status, 0, "Disposable Keychain module round trip failed.");
    assert.equal(child.stdout, "actual-security-roundtrip-ok\n");
    assert.equal(child.stderr, "");
    assert.equal(child.stdout.includes(generatedSecret), false);
  } finally {
    security("delete-keychain", keychain);
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test("async security transport pipes both hidden prompts without exposing them in argv or env", async () => {
  const input = `${generatedSecret}\n${generatedSecret}\n`;
  const inspectInputScript = [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    "const envPresent = Object.prototype.hasOwnProperty.call(",
    "process.env, 'HISTORICAL_DATA_PRESERVATION_HMAC_SECRET');",
    "process.stdout.write(String(Buffer.byteLength(input)) + ':' + String(envPresent));",
    "});",
  ].join("");
  const result = await runHistoricalDataSecurityCommand({
    args: ["-e", inspectInputScript],
    input,
  }, {
    executable: process.execPath,
    timeoutMs: 2_000,
    killGraceMs: 50,
    maximumOutputBytes: 4_096,
  });

  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.failedToStart, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputLimitExceeded, false);
  assert.equal(result.stdout, `${Buffer.byteLength(input)}:false`);
  assert.equal(result.stdout.includes(generatedSecret), false);
});

test("async security transport terminates the detached process group on timeout", {
  skip: process.platform === "win32",
}, async () => {
  const signals: NodeJS.Signals[] = [];
  const result = await runHistoricalDataSecurityCommand({
    args: [
      "-e",
      "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);",
    ],
    input: "",
  }, {
    executable: process.execPath,
    timeoutMs: 250,
    killGraceMs: 50,
    maximumOutputBytes: 64,
    processGroupKiller: (pid, signal) => {
      signals.push(signal);
      process.kill(-pid, signal);
    },
  });

  assert.equal(result.status, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.outputLimitExceeded, false);
  assert.equal(result.stdout, "");
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("parent terminal signals kill the detached security process group", {
  skip: process.platform === "win32",
  timeout: 20_000,
}, async () => {
  for (const signal of ["SIGTERM", "SIGQUIT", "SIGTSTP"] as const) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), `inspir-hmac-parent-${signal.toLowerCase()}-`),
    );
    const sentinel = path.join(root, "detached-child-survived");
    const modulePath = path.join(
      process.cwd(),
      "scripts/cloudflare/historical-data-hmac-key.ts",
    );
    const descendantScript = [
      "const fs = require('node:fs');",
      `setTimeout(() => fs.writeFileSync(${JSON.stringify(sentinel)}, 'survived'), 700);`,
      "setInterval(() => {}, 1000);",
    ].join("");
    const parentScript = [
      `const module = await import(${JSON.stringify(modulePath)});`,
      "void module.runHistoricalDataSecurityCommand({",
      `args: ['-e', ${JSON.stringify(descendantScript)}], input: ''`,
      "}, { executable: process.execPath, timeoutMs: 5000, killGraceMs: 50, maximumOutputBytes: 64 });",
      "process.stdout.write('parent-ready\\n');",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const parent = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", parentScript],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    try {
      await waitForOutput(parent, "parent-ready\n", 3_000);
      assert.equal(parent.kill(signal), true, signal);
      if (signal === "SIGTSTP") {
        await new Promise((resolve) => setTimeout(resolve, 150));
        parent.kill("SIGCONT");
        parent.kill("SIGTERM");
      }
      await waitForClose(parent, 3_000);
      await new Promise((resolve) => setTimeout(resolve, 900));
      assert.equal(fs.existsSync(sentinel), false, signal);
    } finally {
      if (parent.exitCode === null && parent.signalCode === null) {
        parent.kill("SIGCONT");
        parent.kill("SIGKILL");
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("async security transport caps stdout and sanitizes failures", async () => {
  const oversized = await runHistoricalDataSecurityCommand({
    args: [
      "-e",
      "process.on('SIGTERM', () => {}); process.stdout.write('x'.repeat(1024)); setInterval(() => {}, 1000);",
    ],
    input: generatedSecret,
  }, {
    executable: process.execPath,
    timeoutMs: 2_000,
    killGraceMs: 25,
    maximumOutputBytes: 32,
  });
  assert.equal(oversized.outputLimitExceeded, true);
  assert.equal(oversized.stdout, "");

  const missingExecutable = await runHistoricalDataSecurityCommand({
    args: [generatedSecret],
    input: generatedSecret,
  }, {
    executable: "/definitely/missing/inspir-security-test",
    timeoutMs: 250,
    killGraceMs: 25,
    maximumOutputBytes: 32,
  });
  assert.equal(missingExecutable.failedToStart, true);
  assert.equal(missingExecutable.stdout, "");
});

test("operator entrypoints use Keychain lookup and the runbook has no transient HMAC export", () => {
  const preservationSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "scripts/cloudflare/verify-historical-data-preservation.ts",
    ),
    "utf8",
  );
  const continuitySource = fs.readFileSync(
    path.join(
      process.cwd(),
      "scripts/cloudflare/verify-historical-data-continuity.ts",
    ),
    "utf8",
  );
  const deployRunbook = fs.readFileSync(
    path.join(process.cwd(), "deploy.md"),
    "utf8",
  );

  assert.doesNotMatch(
    preservationSource,
    /process\.env\.HISTORICAL_DATA_PRESERVATION_HMAC_SECRET/,
  );
  assert.doesNotMatch(
    continuitySource,
    /process\.env\.HISTORICAL_DATA_PRESERVATION_HMAC_SECRET/,
  );
  assert.match(
    preservationSource,
    /readHistoricalDataHmacKey\(baseline\.hmacKeyId\)/,
  );
  assert.match(
    continuitySource,
    /readArchivedPredecessorBaseline\(backupDir\)/,
  );
  assert.match(continuitySource, /storeHistoricalDataHmacKey/);
  assert.doesNotMatch(
    deployRunbook,
    /export HISTORICAL_DATA_PRESERVATION_HMAC_SECRET|unset HISTORICAL_DATA_PRESERVATION_HMAC_SECRET/,
  );
  assert.match(deployRunbook, /--new-hmac-key/);
  assert.match(deployRunbook, /--escrow-recovered-predecessor-key/);
  assert.match(deployRunbook, /--capture-successor/);
});

function securityResult(
  overrides: Partial<HistoricalDataSecurityCommandResult> = {},
): HistoricalDataSecurityCommandResult {
  return {
    status: null,
    signal: null,
    stdout: "",
    failedToStart: false,
    timedOut: false,
    outputLimitExceeded: false,
    ...overrides,
  };
}

function withKeychainMetadata(
  delegate: HistoricalDataSecurityRunner,
  calls?: HistoricalDataSecurityCommand[],
): HistoricalDataSecurityRunner {
  return (command) => {
    if (command.args[0] === "login-keychain") {
      calls?.push(command);
      return Promise.resolve(securityResult({
        status: 0,
        stdout: `    "${loginKeychain}"\n`,
      }));
    }
    if (command.args[0] === "default-keychain") {
      calls?.push(command);
      return Promise.resolve(securityResult({
        status: 0,
        stdout: `    "${loginKeychain}"\n`,
      }));
    }
    if (command.args[0] === "list-keychains") {
      calls?.push(command);
      return Promise.resolve(securityResult({
        status: 0,
        stdout: `    "${loginKeychain}"\n`,
      }));
    }
    if (command.args[0] === "show-keychain-info") {
      calls?.push(command);
      return Promise.resolve(securityResult({ status: 0 }));
    }
    return delegate(command);
  };
}

function waitForOutput(
  child: ReturnType<typeof spawn>,
  expected: string,
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for child output."));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (!output.includes(expected)) return;
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Child closed before emitting expected output."));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.removeListener("data", onData);
      child.removeListener("close", onClose);
    };
    child.stdout?.on("data", onData);
    child.once("close", onClose);
  });
}

function waitForClose(child: ReturnType<typeof spawn>, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      child.removeListener("close", onClose);
      reject(new Error("Timed out waiting for child termination."));
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once("close", onClose);
  });
}
