import assert from "node:assert/strict";
import test from "node:test";
import { assessReactDoctorReport, parseReactDoctorReport } from "../scripts/cloudflare/run-react-doctor-gate";

test("React Doctor gate parses prefixed JSON output", () => {
  const report = parseReactDoctorReport(`Full diagnostics written to tmp/react-doctor
{
  "ok": true,
  "summary": {
    "errorCount": 0,
    "warningCount": 0,
    "totalDiagnosticCount": 0,
    "score": 100,
    "scoreLabel": "Perfect"
  }
}
`);

  assert.equal(report.ok, true);
  assert.equal(report.summary?.score, 100);
});

test("React Doctor gate accepts only a perfect report", () => {
  const result = assessReactDoctorReport(
    {
      ok: true,
      summary: {
        errorCount: 0,
        warningCount: 0,
        totalDiagnosticCount: 0,
        score: 100,
        scoreLabel: "Perfect",
      },
    },
    0,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
});

test("React Doctor gate rejects warning reports", () => {
  const result = assessReactDoctorReport(
    {
      ok: true,
      summary: {
        errorCount: 0,
        warningCount: 1,
        totalDiagnosticCount: 1,
        score: 98,
        scoreLabel: "Great",
      },
    },
    1,
  );

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("warnings")));
  assert.ok(result.blockers.some((blocker) => blocker.includes("score")));
});
