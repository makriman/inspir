import { pathToFileURL } from "node:url";
import {
  historicalFresh0016JsonSha256,
  readHistoricalFresh0016FinalVerificationContext,
  readHistoricalFresh0016PreservationReference,
} from "./historical-data-fresh-0016-preservation-cli-adapter";
import { runHistoricalDataPreservationCli } from "./verify-historical-data-preservation";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runHistoricalDataPreservationCli({
    readFresh0016PreservationReference:
      readHistoricalFresh0016PreservationReference,
    readFresh0016FinalVerificationContext:
      readHistoricalFresh0016FinalVerificationContext,
    canonicalFresh0016JsonSha256: historicalFresh0016JsonSha256,
  }).catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Historical data preservation failed.",
    );
    process.exitCode = 1;
  });
}
