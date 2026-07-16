import { pathToFileURL } from "node:url";
import { resolveBackupDir } from "./migration-config";
import { readAndValidatePreviewE2EEvidence } from "./preview-e2e-evidence";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const handle = readAndValidatePreviewE2EEvidence({
      cwd: process.cwd(),
      backupDirectory: resolveBackupDir(),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          path: handle.path,
          sha256: handle.sha256,
          createdAt: handle.validation.createdAt,
          sourceFingerprint: handle.validation.sourceFingerprint,
          totalTests: handle.validation.totalTests,
          requiredPassedTitles: handle.validation.requiredPassedTitles,
          skippedTitles: handle.validation.skippedTitles,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
