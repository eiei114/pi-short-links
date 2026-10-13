import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSmokeReport } from "../scripts/pi-sdk-smoke-report.mjs";

test("smoke report defaults preserve tracked evidence and explicit opt-in records it", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-short-links-report-test-"));
  const root = join(temporaryDirectory, "repo");
  const trackedReport = join(root, "docs/verification/pi-sdk-smoke.json");
  const originalEvidence = Buffer.from('{"platform":"win32","evidence":"committed"}\n');
  const report = { platform: "linux", cases: [] };

  try {
    mkdirSync(join(root, "docs/verification"), { recursive: true });
    writeFileSync(trackedReport, originalEvidence);

    const temporaryReport = writeSmokeReport(report, {
      root, args: [], temporaryDirectory, processId: "default",
    });
    assert.notEqual(temporaryReport, trackedReport);
    assert.deepEqual(readFileSync(trackedReport), originalEvidence);
    assert.deepEqual(JSON.parse(readFileSync(temporaryReport, "utf8")), report);

    const recordedReport = writeSmokeReport(report, { root, args: ["--write-report"] });
    assert.equal(recordedReport, trackedReport);
    assert.deepEqual(JSON.parse(readFileSync(trackedReport, "utf8")), report);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
