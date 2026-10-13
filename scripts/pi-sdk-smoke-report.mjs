import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export function writeSmokeReport(report, {
  root,
  args = process.argv.slice(2),
  temporaryDirectory = tmpdir(),
  processId = process.pid,
}) {
  const reportPath = args.includes("--write-report")
    ? resolve(root, "docs/verification/pi-sdk-smoke.json")
    : resolve(temporaryDirectory, `pi-short-links-sdk-smoke-${processId}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}
