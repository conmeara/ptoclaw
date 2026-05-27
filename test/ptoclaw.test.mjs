import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = path.resolve("bin/ptoclaw.mjs");

async function tempRoot() {
  const candidates = [
    process.env.PTOCLAW_TEST_TMPDIR,
    process.env.TMPDIR,
    os.tmpdir(),
    path.resolve(".tmp"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.mkdir(candidate, { recursive: true });
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("No writable temporary directory found");
}

async function tempDb() {
  const dir = await fs.mkdtemp(path.join(await tempRoot(), "ptoclaw-test-"));
  return path.join(dir, "ptoclaw.sqlite");
}

async function run(args, options = {}) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, PTOCLAW_DB: "" },
    ...options,
  });
}

async function json(args) {
  const { stdout } = await run(["--json", ...args]);
  return JSON.parse(stdout);
}

async function seededDb() {
  const db = await tempDb();
  await run(["--db", db, "init"]);
  await run([
    "--db",
    db,
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
  return db;
}

test("prints help and version", async () => {
  const help = await run(["--help"]);
  assert.match(help.stdout, /Usage:/);
  assert.match(help.stdout, /calendar sync --dry-run/);

  const version = await run(["--version"]);
  assert.equal(version.stdout.trim(), "0.1.0");
});

test("dry-run plan add does not write", async () => {
  const db = await seededDb();
  const dryRun = await json([
    "--db",
    db,
    "plan",
    "add",
    "--start",
    "2026-02-02",
    "--end",
    "2026-02-06",
    "--type",
    "vacation",
    "--status",
    "planned",
    "--title",
    "Winter break",
    "--dry-run",
  ]);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.plan.total_hours, 40);
  assert.match(dryRun.plan.preview_calendar_external_id, /^ptoclaw:pending:2026-02-02:2026-02-06$/);

  const list = await json(["--db", db, "plan", "list"]);
  assert.equal(list.plans.length, 0);
});

test("remove requires force or dry-run", async () => {
  const db = await seededDb();
  await run([
    "--db",
    db,
    "plan",
    "add",
    "--start",
    "2026-03-02",
    "--end",
    "2026-03-03",
    "--type",
    "personal",
    "--status",
    "planned",
    "--title",
    "Long weekend",
  ]);

  await assert.rejects(run(["--db", db, "plan", "remove", "1"]), /Refusing to remove/);

  const dryRun = await json(["--db", db, "plan", "remove", "1", "--dry-run"]);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.plan.id, 1);

  const removed = await json(["--db", db, "plan", "remove", "1", "--force"]);
  assert.equal(removed.dryRun, false);
  const list = await json(["--db", db, "plan", "list"]);
  assert.equal(list.plans.length, 0);
});

test("forecast math honors --as-of", async () => {
  const db = await seededDb();
  await run([
    "--db",
    db,
    "plan",
    "add",
    "--start",
    "2026-03-02",
    "--end",
    "2026-03-06",
    "--type",
    "vacation",
    "--status",
    "planned",
    "--title",
    "Spring break",
  ]);

  const forecast = await json([
    "--db",
    db,
    "forecast",
    "--through",
    "2026-04-01",
    "--as-of",
    "2026-01-01",
  ]);
  assert.equal(forecast.accrualPeriods, 3);
  assert.equal(forecast.accruedHours, 24);
  assert.equal(forecast.plannedHours, 40);
  assert.equal(forecast.endingBalanceHours, 64);
});

test("status and plan list produce JSON", async () => {
  const db = await seededDb();
  const status = await json(["--db", db, "status", "--as-of", "2026-01-01"]);
  assert.equal(status.asOf, "2026-01-01");
  assert.equal(status.settings.balance_hours, 80);

  const list = await json(["--db", db, "plan", "list", "--json"]);
  assert.deepEqual(list.plans, []);
});

test("calendar dry-run emits stable external IDs", async () => {
  const db = await seededDb();
  await run([
    "--db",
    db,
    "plan",
    "add",
    "--start",
    "2027-01-04",
    "--end",
    "2027-01-08",
    "--type",
    "vacation",
    "--status",
    "planned",
    "--title",
    "New year",
  ]);

  const sync = await json(["--db", db, "calendar", "sync", "--dry-run"]);
  assert.equal(sync.dryRun, true);
  assert.equal(sync.events.length, 1);
  assert.equal(sync.events[0].externalId, "ptoclaw:1:2027-01-04:2027-01-08");
  assert.equal(sync.events[0].endDate, "2027-01-09");
});
