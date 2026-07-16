import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCurrentTranslationFallbackAttestationCli } from "./staged-translation-fallback-release-attestation";

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    runCurrentTranslationFallbackAttestationCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[translations:attest-current-fallback] ${message.slice(0, 2_048)}\n`,
    );
    process.exitCode = 1;
  }
}
