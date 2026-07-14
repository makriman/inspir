import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const HISTORICAL_DATA_HMAC_ENV_NAME =
  "HISTORICAL_DATA_PRESERVATION_HMAC_SECRET" as const;
export const HISTORICAL_DATA_HMAC_KEYCHAIN_SERVICE =
  "com.inspirlearning.release.historical-data-preservation-v1" as const;
export const HISTORICAL_DATA_HMAC_KEYCHAIN_LABEL =
  "InspirLearning historical-data preservation key" as const;
export const HISTORICAL_DATA_SECURITY_EXECUTABLE = "/usr/bin/security" as const;

const generatedSecretPattern = /^[a-f0-9]{64}$/;
const hmacKeyIdPattern = /^[a-f0-9]{64}$/;
const securityTimeoutMs = 60_000;
const securityKillGraceMs = 1_000;
const securityMaximumOutputBytes = 4_096;

export type HistoricalDataSecurityCommand = Readonly<{
  args: readonly string[];
  input: string;
}>;

export type HistoricalDataSecurityCommandResult = Readonly<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  failedToStart: boolean;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}>;

export type HistoricalDataSecurityRunner = (
  command: HistoricalDataSecurityCommand,
) => Promise<HistoricalDataSecurityCommandResult>;

export type HistoricalDataSecurityExecutionOptions = Readonly<{
  executable?: string;
  timeoutMs?: number;
  killGraceMs?: number;
  maximumOutputBytes?: number;
  processGroupKiller?: (
    pid: number,
    signal: NodeJS.Signals,
  ) => void;
}>;

export type HistoricalDataHmacKey = Readonly<{
  hmacKeyId: string;
  secret: string;
}>;

type HistoricalDataHmacKeyOptions = Readonly<{
  platform?: NodeJS.Platform;
  runner?: HistoricalDataSecurityRunner;
}>;

type CreateHistoricalDataHmacKeyOptions = HistoricalDataHmacKeyOptions & Readonly<{
  randomBytesProvider?: (size: number) => Uint8Array;
}>;

export function requireHistoricalHmacSecret(value: string) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 32 || bytes > 512) {
    throw new Error(
      `${HISTORICAL_DATA_HMAC_ENV_NAME} must contain 32 to 512 UTF-8 bytes.`,
    );
  }
  return value;
}

export function historicalDataHmacKeyId(value: string) {
  const secret = requireHistoricalHmacSecret(value);
  return createHmac("sha256", secret)
    .update("inspir-preservation-key-id-v1")
    .digest("hex");
}

export async function createHistoricalDataHmacKey(
  options: CreateHistoricalDataHmacKeyOptions = {},
): Promise<HistoricalDataHmacKey> {
  const randomBytesProvider = options.randomBytesProvider ??
    ((size: number) => randomBytes(size));
  const generatedBytes = randomBytesProvider(32);
  if (generatedBytes.byteLength !== 32) {
    throw new Error(
      "Historical-data HMAC generation returned the wrong byte length.",
    );
  }
  const secret = Buffer.from(generatedBytes).toString("hex");
  if (!generatedSecretPattern.test(secret)) {
    throw new Error("Historical-data HMAC generation returned an invalid secret.");
  }
  const hmacKeyId = historicalDataHmacKeyId(secret);
  return await storeHistoricalDataHmacKeyInternal(
    secret,
    hmacKeyId,
    options,
    true,
  );
}

export async function storeHistoricalDataHmacKey(
  secret: string,
  expectedHmacKeyId: string,
  options: HistoricalDataHmacKeyOptions = {},
): Promise<HistoricalDataHmacKey> {
  return await storeHistoricalDataHmacKeyInternal(
    secret,
    expectedHmacKeyId,
    options,
    false,
  );
}

async function storeHistoricalDataHmacKeyInternal(
  secret: string,
  expectedHmacKeyId: string,
  options: HistoricalDataHmacKeyOptions,
  mustBeAbsent: boolean,
): Promise<HistoricalDataHmacKey> {
  requireGeneratedHistoricalHmacSecret(secret);
  requireHmacKeyId(expectedHmacKeyId);
  const actualHmacKeyId = historicalDataHmacKeyId(secret);
  if (!timingSafeHexEqual(actualHmacKeyId, expectedHmacKeyId)) {
    throw new Error(
      "The recovered historical-data HMAC does not match the expected identity.",
    );
  }
  const runner = requireKeychainRunner(options);
  const hmacKeyId = expectedHmacKeyId;
  const loginKeychain = await resolveHistoricalDataLoginKeychainPath(runner);
  const existing = await runner({
    args: findArguments(hmacKeyId, loginKeychain),
    input: "",
  });
  if (securitySucceeded(existing)) {
    if (mustBeAbsent) {
      throw new Error(
        "Historical-data HMAC Keychain identity already exists; refusing overwrite.",
      );
    }
    return validateStoredKey(hmacKeyId, existing.stdout);
  }
  if (!securityReportedMissing(existing)) {
    throw new Error(
      "Unable to prove the historical-data HMAC Keychain identity is absent.",
    );
  }
  const loginKeychainBeforeAdd = await resolveHistoricalDataLoginKeychainPath(
    runner,
  );
  if (loginKeychainBeforeAdd !== loginKeychain) {
    throw new Error(
      "The macOS login Keychain changed before historical-data HMAC storage.",
    );
  }
  const added = await runner({
    args: addArguments(hmacKeyId),
    input: `${secret}\n${secret}\n`,
  });
  const loginKeychainAfterAdd = await resolveHistoricalDataLoginKeychainPath(
    runner,
  );
  if (loginKeychainAfterAdd !== loginKeychain) {
    throw new Error(
      "The macOS login Keychain changed during historical-data HMAC storage.",
    );
  }
  const readback = await runner({
    args: findArguments(hmacKeyId, loginKeychain),
    input: "",
  });
  if (securitySucceeded(readback)) {
    try {
      const stored = validateStoredKey(hmacKeyId, readback.stdout);
      if (timingSafeHexEqual(stored.secret, secret)) return stored;
    } catch {
      // Fall through to one sanitized failure after an exact readback attempt.
    }
  }
  if (!securitySucceeded(added)) {
    throw new Error("Unable to store the historical-data HMAC in Keychain.");
  }
  throw new Error(
    "Historical-data HMAC Keychain readback did not match the generated key.",
  );
}

export async function readHistoricalDataHmacKey(
  hmacKeyId: string,
  options: HistoricalDataHmacKeyOptions = {},
): Promise<HistoricalDataHmacKey> {
  requireHmacKeyId(hmacKeyId);
  const runner = requireKeychainRunner(options);
  const loginKeychain = await resolveHistoricalDataLoginKeychainPath(runner);
  const result = await runner({
    args: findArguments(hmacKeyId, loginKeychain),
    input: "",
  });
  if (securityReportedMissing(result)) {
    throw new Error("The required historical-data HMAC is absent from Keychain.");
  }
  if (!securitySucceeded(result)) {
    throw new Error(
      "Unable to read the required historical-data HMAC from Keychain.",
    );
  }
  return validateStoredKey(hmacKeyId, result.stdout);
}

export async function runHistoricalDataSecurityCommand(
  command: HistoricalDataSecurityCommand,
  executionOptions: HistoricalDataSecurityExecutionOptions = {},
): Promise<HistoricalDataSecurityCommandResult> {
  const executable = requireAbsoluteExecutable(
    executionOptions.executable ?? HISTORICAL_DATA_SECURITY_EXECUTABLE,
  );
  const timeoutMs = requirePositiveInteger(
    executionOptions.timeoutMs ?? securityTimeoutMs,
    "security command timeout",
  );
  const killGraceMs = requirePositiveInteger(
    executionOptions.killGraceMs ?? securityKillGraceMs,
    "security command kill grace period",
  );
  const maximumOutputBytes = requirePositiveInteger(
    executionOptions.maximumOutputBytes ?? securityMaximumOutputBytes,
    "security command output limit",
  );
  const processGroupKiller = executionOptions.processGroupKiller ??
    defaultProcessGroupKiller;

  let child: ChildProcess;
  try {
    child = spawn(executable, [...command.args], {
      cwd: "/",
      detached: true,
      env: historicalDataSecurityEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return failedSecurityCommandResult();
  }

  return await new Promise<HistoricalDataSecurityCommandResult>((resolve) => {
    let completed = false;
    let failedToStart = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let terminationRequested = false;
    let forceKillSent = false;
    let stdoutBytes = 0;
    let stdoutChunks: Buffer[] = [];
    let forceKillTimer: NodeJS.Timeout | undefined;
    const parentSignalHandlers = new Map<NodeJS.Signals, () => void>();
    const parentExitHandler = () => {
      terminateSecurityProcess(child, "SIGKILL", processGroupKiller);
    };

    const removeParentTerminationHandlers = () => {
      for (const [signal, handler] of parentSignalHandlers) {
        process.removeListener(signal, handler);
      }
      parentSignalHandlers.clear();
      process.removeListener("exit", parentExitHandler);
    };

    for (const signal of [
      "SIGINT",
      "SIGTERM",
      "SIGHUP",
      "SIGQUIT",
      "SIGTSTP",
    ] as const) {
      const handler = () => {
        terminateSecurityProcess(child, "SIGKILL", processGroupKiller);
        removeParentTerminationHandlers();
        try {
          process.kill(process.pid, signal);
        } catch {
          process.exitCode = 1;
        }
      };
      parentSignalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    process.once("exit", parentExitHandler);

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stdoutChunks = [];
      requestTermination();
    }, timeoutMs);

    const finish = (
      status: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      removeParentTerminationHandlers();
      const succeeded = !failedToStart &&
        !timedOut &&
        !outputLimitExceeded &&
        signal === null &&
        status === 0;
      resolve({
        status,
        signal,
        stdout: succeeded ? Buffer.concat(stdoutChunks).toString("utf8") : "",
        failedToStart,
        timedOut,
        outputLimitExceeded,
      });
    };

    const terminate = (signal: NodeJS.Signals) => {
      terminateSecurityProcess(child, signal, processGroupKiller);
    };

    const forceKill = () => {
      if (forceKillSent) return;
      forceKillSent = true;
      terminate("SIGKILL");
    };

    function requestTermination() {
      terminationRequested = true;
      terminate("SIGTERM");
      if (forceKillTimer) return;
      forceKillTimer = setTimeout(() => {
        forceKill();
      }, killGraceMs);
    }

    child.once("error", () => {
      failedToStart = true;
      stdoutChunks = [];
      forceKill();
      finish(null, null);
    });
    child.once("close", (status, signal) => {
      if (terminationRequested) forceKill();
      finish(status, signal);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (completed || outputLimitExceeded) return;
      if (stdoutBytes + chunk.byteLength > maximumOutputBytes) {
        outputLimitExceeded = true;
        stdoutChunks = [];
        requestTermination();
        return;
      }
      stdoutBytes += chunk.byteLength;
      stdoutChunks.push(chunk);
    });
    child.stdout?.once("error", () => {
      failedToStart = true;
      stdoutChunks = [];
      requestTermination();
    });
    child.stdin?.once("error", () => {
      // The process exit status remains authoritative for an early stdin close.
    });
    try {
      child.stdin?.end(command.input);
    } catch {
      failedToStart = true;
      stdoutChunks = [];
      requestTermination();
    }
  });
}

function historicalDataSecurityEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME,
    LANG: "C",
    LC_ALL: "C",
    LOGNAME: process.env.LOGNAME,
    NODE_ENV: process.env.NODE_ENV,
    PATH: "/usr/bin:/bin",
    USER: process.env.USER,
  };
}

function terminateSecurityProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
  processGroupKiller: (pid: number, signal: NodeJS.Signals) => void,
) {
  const pid = child.pid;
  if (typeof pid === "number" && pid > 0) {
    try {
      processGroupKiller(pid, signal);
      return;
    } catch {
      // Fall back to terminating the direct process when group cleanup fails.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The process may have exited between the event and cleanup attempt.
  }
}

function defaultProcessGroupKiller(pid: number, signal: NodeJS.Signals) {
  process.kill(-pid, signal);
}

function failedSecurityCommandResult(): HistoricalDataSecurityCommandResult {
  return {
    status: null,
    signal: null,
    stdout: "",
    failedToStart: true,
    timedOut: false,
    outputLimitExceeded: false,
  };
}

function requireAbsoluteExecutable(value: string) {
  if (
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("Security command executable must be a normalized absolute path.");
  }
  return value;
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function requireKeychainRunner(options: HistoricalDataHmacKeyOptions) {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new Error("Historical-data HMAC escrow requires the macOS Keychain.");
  }
  return options.runner ?? runHistoricalDataSecurityCommand;
}

function findArguments(hmacKeyId: string, loginKeychain: string) {
  return [
    "find-generic-password",
    "-a",
    hmacKeyId,
    "-s",
    HISTORICAL_DATA_HMAC_KEYCHAIN_SERVICE,
    "-w",
    loginKeychain,
  ] as const;
}

function addArguments(hmacKeyId: string) {
  return [
    "add-generic-password",
    "-a",
    hmacKeyId,
    "-s",
    HISTORICAL_DATA_HMAC_KEYCHAIN_SERVICE,
    "-D",
    "application password",
    "-l",
    HISTORICAL_DATA_HMAC_KEYCHAIN_LABEL,
    "-T",
    HISTORICAL_DATA_SECURITY_EXECUTABLE,
    "-w",
  ] as const;
}

export async function resolveHistoricalDataLoginKeychainPath(
  runner: HistoricalDataSecurityRunner = runHistoricalDataSecurityCommand,
) {
  const loginResult = await runner({
    args: ["login-keychain"],
    input: "",
  });
  if (!securitySucceeded(loginResult)) {
    throw new Error("Unable to resolve the effective macOS login Keychain.");
  }
  const loginKeychain = canonicalKeychainFile(
    parseSingleKeychainPath(loginResult.stdout, "login"),
    "login",
  );
  const defaultResult = await runner({
    args: ["default-keychain", "-d", "user"],
    input: "",
  });
  if (!securitySucceeded(defaultResult)) {
    throw new Error("Unable to resolve the macOS default Keychain.");
  }
  const defaultKeychain = parseSingleKeychainPath(
    defaultResult.stdout,
    "default",
  );
  if (canonicalKeychainFile(defaultKeychain, "default") !== loginKeychain) {
    throw new Error(
      "Historical-data HMAC creation requires the login Keychain to be the default Keychain.",
    );
  }
  const searchListResult = await runner({
    args: ["list-keychains", "-d", "user"],
    input: "",
  });
  if (!securitySucceeded(searchListResult)) {
    throw new Error("Unable to resolve the macOS user Keychain search list.");
  }
  const searchList = parseKeychainPathList(searchListResult.stdout).map(
    (candidate) => canonicalKeychainFile(candidate, "search-list"),
  );
  if (searchList.filter((candidate) => candidate === loginKeychain).length !== 1) {
    throw new Error(
      "The login Keychain is missing or duplicated in the user Keychain search list.",
    );
  }
  const infoResult = await runner({
    args: ["show-keychain-info", loginKeychain],
    input: "",
  });
  if (!securitySucceeded(infoResult)) {
    throw new Error("Unable to inspect the effective macOS login Keychain.");
  }
  return loginKeychain;
}

function parseSingleKeychainPath(stdout: string, label: string) {
  const keychains = parseKeychainPathList(stdout);
  if (keychains.length !== 1) {
    throw new Error(`The macOS ${label} Keychain path is malformed.`);
  }
  return keychains[0];
}

function parseKeychainPathList(stdout: string) {
  const output = stdout.endsWith("\r\n")
    ? stdout.slice(0, -2)
    : stdout.endsWith("\n")
      ? stdout.slice(0, -1)
      : stdout;
  if (!output) return [];
  const keychains = output.split(/\r?\n/).map((line) => {
    const match = /^[ \t]*"([^"\r\n]+)"[ \t]*$/.exec(line);
    const keychainPath = match?.[1];
    if (
      !keychainPath ||
      !path.isAbsolute(keychainPath) ||
      path.normalize(keychainPath) !== keychainPath ||
      /[\u0000-\u001f\u007f]/.test(keychainPath)
    ) {
      throw new Error("The macOS user Keychain search list is malformed.");
    }
    return keychainPath;
  });
  if (new Set(keychains).size !== keychains.length) {
    throw new Error("The macOS user Keychain search list contains duplicate paths.");
  }
  return keychains;
}

function canonicalKeychainFile(file: string, label: string) {
  let canonical: string;
  let stat: fs.Stats;
  try {
    canonical = fs.realpathSync.native(file);
    stat = fs.lstatSync(canonical);
  } catch {
    throw new Error(`The macOS ${label} Keychain is unavailable.`);
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(`The macOS ${label} Keychain is not an owner-controlled regular file.`);
  }
  return canonical;
}

function parseStoredSecret(stdout: string) {
  const secret = stdout.endsWith("\r\n")
    ? stdout.slice(0, -2)
    : stdout.endsWith("\n")
      ? stdout.slice(0, -1)
      : stdout;
  if (!generatedSecretPattern.test(secret)) {
    throw new Error(
      "The historical-data HMAC stored in Keychain has an invalid format.",
    );
  }
  return secret;
}

export function requireGeneratedHistoricalHmacSecret(secret: string) {
  if (!generatedSecretPattern.test(secret)) {
    throw new Error(
      "Recovered historical-data HMAC must be exactly 64 lowercase hexadecimal characters.",
    );
  }
  return secret;
}

function validateStoredKey(hmacKeyId: string, stdout: string) {
  const secret = parseStoredSecret(stdout);
  const actualKeyId = historicalDataHmacKeyId(secret);
  if (!timingSafeHexEqual(actualKeyId, hmacKeyId)) {
    throw new Error(
      "The historical-data HMAC does not match the requested Keychain identity.",
    );
  }
  return { hmacKeyId, secret };
}

function requireHmacKeyId(value: string) {
  if (!hmacKeyIdPattern.test(value)) {
    throw new Error(
      "Historical-data HMAC Keychain identity must be a lowercase SHA-256 value.",
    );
  }
}

function timingSafeHexEqual(left: string, right: string) {
  if (!hmacKeyIdPattern.test(left) || !hmacKeyIdPattern.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function securitySucceeded(result: HistoricalDataSecurityCommandResult) {
  return !result.failedToStart &&
    !result.timedOut &&
    !result.outputLimitExceeded &&
    result.signal === null &&
    result.status === 0;
}

function securityReportedMissing(result: HistoricalDataSecurityCommandResult) {
  return !result.failedToStart &&
    !result.timedOut &&
    !result.outputLimitExceeded &&
    result.signal === null &&
    result.status === 44;
}
