import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve("bin/ptoclaw.mjs");

function tempRoot() {
  const candidates = [
    process.env.PTOCLAW_TEST_TMPDIR,
    process.env.TMPDIR,
    os.tmpdir(),
    path.resolve(".tmp"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("No writable temporary directory found");
}

const dir = fs.mkdtempSync(path.join(tempRoot(), "ptoclaw-smoke-"));
const db = path.join(dir, "ptoclaw.sqlite");

function run(args) {
  return execFileSync(process.execPath, [cli, "--db", db, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
}

run(["init"]);
run([
  "settings",
  "set",
  "--balance-hours",
  "80",
  "--accrual-hours",
  "8",
  "--accrual-cadence",
  "monthly",
  "--hours-per-day",
  "8",
  "--as-of",
  "2026-01-01",
]);
run([
  "plan",
  "add",
  "--start",
  "2026-07-06",
  "--end",
  "2026-07-10",
  "--type",
  "vacation",
  "--status",
  "planned",
  "--title",
  "Summer break",
]);
JSON.parse(run(["--json", "status", "--as-of", "2026-01-01"]));
run(["forecast", "--through", "2026-12-31", "--as-of", "2026-01-01"]);
const summary = JSON.parse(run(["--json", "summary", "months", "--year", "2026", "--as-of", "2026-01-01"]));
if (summary.months.length !== 12 || !summary.months[0]?.indicator) {
  throw new Error("monthly summary did not emit twelve indicated months");
}
const calendar = JSON.parse(run(["--json", "calendar", "sync", "--dry-run"]));
if (!calendar.events[0]?.externalId?.startsWith("ptoclaw:")) {
  throw new Error("calendar dry-run did not emit a stable ptoclaw external ID");
}

console.log("ptoclaw smoke ok");
