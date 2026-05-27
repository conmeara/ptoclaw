#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const message = typeof warning === "string" ? warning : warning?.message;
  if (message?.includes("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...args);
};
const { DatabaseSync } = await import("node:sqlite");
process.emitWarning = originalEmitWarning;

const VERSION = "0.1.0";
const SCHEMA_VERSION = "2";
const DEFAULT_DB = "~/.local/share/ptoclaw/ptoclaw.sqlite";
const CONFIG_FILE_NAME = "config.json";
const VALID_TYPES = new Set(["vacation", "sick", "holiday", "personal"]);
const VALID_STATUSES = new Set(["planned", "tentative"]);
const VALID_CADENCES = new Set(["monthly", "semimonthly", "biweekly", "weekly"]);
const CONSUMING_TYPES = new Set(["vacation", "sick", "personal"]);
const DAY_MS = 86_400_000;

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function usage() {
  return `ptoclaw ${VERSION}

Usage:
  ptoclaw [--db PATH] [--json] [--no-input] [--verbose] <command>

Commands:
  init
  onboard [--balance-hours N|--balance-days N] [--accrual-hours N|--accrual-days N] [--accrual-cadence monthly|semimonthly|biweekly|weekly] [--hours-per-day N] [--as-of YYYY-MM-DD] [--pto-calendar TEXT] [--pto-event-pattern TEXT] [--holiday-calendar TEXT|--no-holiday-calendar] [--holiday-event-pattern TEXT] [--dry-run]
  status [--as-of YYYY-MM-DD]
  settings set --balance-hours N --accrual-hours N --accrual-cadence monthly|semimonthly|biweekly|weekly --hours-per-day N [--as-of YYYY-MM-DD]
  plan add --start YYYY-MM-DD --end YYYY-MM-DD --type vacation|sick|holiday|personal --status planned|tentative --title TEXT [--notes TEXT] [--dry-run]
  plan list [--upcoming] [--json]
  plan remove <id> [--force|--dry-run]
  forecast --through YYYY-MM-DD [--as-of YYYY-MM-DD]
  summary months [--year YYYY] [--as-of YYYY-MM-DD] [--json]
  calendar sync --dry-run [--json]
  db stats

Global options:
  --db PATH       SQLite database path. Defaults to PTOCLAW_DB, saved config, or ${DEFAULT_DB}
  --json          Emit machine-readable JSON
  --no-input      Disable interactive prompts; accepted for agent workflows
  --verbose       Include extra diagnostics where available
  -h, --help      Show help
  -v, --version   Show version
`;
}

function parseArgv(argv) {
  const globals = {
    db: null,
    dbSource: null,
    json: false,
    noInput: false,
    verbose: false,
    help: false,
    version: false,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") {
      globals.db = takeValue(argv, ++i, "--db");
      globals.dbSource = "flag";
    } else if (arg === "--json") {
      globals.json = true;
    } else if (arg === "--no-input") {
      globals.noInput = true;
    } else if (arg === "--verbose") {
      globals.verbose = true;
    } else if (arg === "-h" || arg === "--help") {
      globals.help = true;
    } else if (arg === "-v" || arg === "--version") {
      globals.version = true;
    } else {
      rest.push(arg);
    }
  }

  return { globals, rest };
}

function resolveGlobalDb(globals) {
  if (globals.db) return globals;
  if (process.env.PTOCLAW_DB) {
    globals.db = process.env.PTOCLAW_DB;
    globals.dbSource = "env";
    return globals;
  }
  const config = readConfig();
  if (config.dbPath) {
    globals.db = config.dbPath;
    globals.dbSource = "config";
    return globals;
  }
  globals.db = DEFAULT_DB;
  globals.dbSource = "default";
  return globals;
}

function configPath() {
  const base = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(base, "ptoclaw", CONFIG_FILE_NAME);
}

function readConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new CliError(`Could not read PTOClaw config at ${file}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`PTOClaw config at ${file} must be a JSON object`);
  }
  if (parsed.dbPath !== undefined && typeof parsed.dbPath !== "string") {
    throw new CliError(`PTOClaw config at ${file} must use a string dbPath`);
  }
  return parsed;
}

function writeConfig(config) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function saveDbPathConfig(dbPath) {
  const config = readConfig();
  config.dbPath = expandPath(dbPath);
  return writeConfig(config);
}

async function maybePromptForOnboardingDb(command, globals) {
  const promptable = command === "onboard"
    && globals.dbSource === "default"
    && !globals.noInput
    && process.stdin.isTTY;
  if (!promptable) return globals;

  const asker = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await asker.question(`SQLite DB path [${DEFAULT_DB}]: `);
    globals.db = answer.trim() === "" ? DEFAULT_DB : answer.trim();
    globals.dbSource = "prompt";
    return globals;
  } finally {
    asker.close();
  }
}

function parseOptions(args) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (["dry-run", "force", "upcoming", "no-holiday-calendar"].includes(name)) {
      options[toCamel(name)] = true;
    } else {
      options[toCamel(name)] = takeValue(args, ++i, arg);
    }
  }
  return { positionals, options };
}

function takeValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new CliError(`${optionName} requires a value`);
  }
  return value;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function fromCamel(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function expandPath(value) {
  if (!value) return expandPath(DEFAULT_DB);
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function openDb(dbPath) {
  const resolved = expandPath(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON");
  return { db, dbPath: resolved };
}

function schemaSql() {
  return `
CREATE TABLE IF NOT EXISTS ptoclaw_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ptoclaw_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  balance_hours REAL NOT NULL DEFAULT 0,
  accrual_hours REAL NOT NULL DEFAULT 0,
  accrual_cadence TEXT NOT NULL DEFAULT 'monthly',
  hours_per_day REAL NOT NULL DEFAULT 8,
  as_of_date TEXT NOT NULL DEFAULT (date('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ptoclaw_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  hours_per_day REAL NOT NULL,
  workday_count INTEGER NOT NULL,
  total_hours REAL NOT NULL,
  calendar_external_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ptoclaw_calendar_sync (
  plan_id INTEGER PRIMARY KEY REFERENCES ptoclaw_plans(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'apple-calendar',
  last_action TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ptoclaw_calendar_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pto_calendar_name TEXT,
  pto_event_pattern TEXT NOT NULL DEFAULT 'PTO|OOO|Vacation',
  holiday_calendar_name TEXT,
  holiday_event_pattern TEXT NOT NULL DEFAULT 'Holiday|Office closed',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ptoclaw_plans_dates_idx ON ptoclaw_plans(start_date, end_date);
CREATE INDEX IF NOT EXISTS ptoclaw_plans_status_type_idx ON ptoclaw_plans(status, type);
`;
}

function initSchema(db, asOf = todayIso()) {
  db.exec(schemaSql());
  db.prepare(`
    INSERT INTO ptoclaw_meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(SCHEMA_VERSION);
  db.prepare("INSERT OR IGNORE INTO ptoclaw_settings (id, as_of_date) VALUES (1, ?)").run(asOf);
  db.prepare("INSERT OR IGNORE INTO ptoclaw_calendar_preferences (id) VALUES (1)").run();
}

function hasSchema(db) {
  return hasTable(db, "ptoclaw_settings");
}

function hasTable(db, name) {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row?.ok);
}

function requireSchema(db) {
  if (!hasSchema(db)) {
    throw new CliError("Database is not initialized. Run `ptoclaw init` first.");
  }
  initSchema(db);
}

function getSettings(db) {
  if (!hasTable(db, "ptoclaw_settings")) return defaultSettings();
  return db.prepare("SELECT * FROM ptoclaw_settings WHERE id = 1").get();
}

function getCalendarPreferences(db) {
  if (!hasTable(db, "ptoclaw_calendar_preferences")) return defaultCalendarPreferences();
  return db.prepare("SELECT * FROM ptoclaw_calendar_preferences WHERE id = 1").get();
}

function defaultSettings(asOf = todayIso()) {
  return {
    id: 1,
    balance_hours: 0,
    accrual_hours: 0,
    accrual_cadence: "monthly",
    hours_per_day: 8,
    as_of_date: asOf,
    updated_at: null,
  };
}

function defaultCalendarPreferences() {
  return {
    id: 1,
    pto_calendar_name: null,
    pto_event_pattern: "PTO|OOO|Vacation",
    holiday_calendar_name: null,
    holiday_event_pattern: "Holiday|Office closed",
    updated_at: null,
  };
}

function setSettings(db, options) {
  const required = ["balanceHours", "accrualHours", "accrualCadence", "hoursPerDay"];
  for (const key of required) {
    if (options[key] === undefined) throw new CliError(`settings set requires --${fromCamel(key)}`);
  }
  const settings = {
    balanceHours: parseNumber(options.balanceHours, "--balance-hours"),
    accrualHours: parseNumber(options.accrualHours, "--accrual-hours"),
    accrualCadence: options.accrualCadence,
    hoursPerDay: parseNumber(options.hoursPerDay, "--hours-per-day"),
    asOfDate: options.asOf ? isoDate(parseDate(options.asOf, "--as-of")) : getSettings(db).as_of_date,
  };
  if (!VALID_CADENCES.has(settings.accrualCadence)) {
    throw new CliError("--accrual-cadence must be monthly, semimonthly, biweekly, or weekly");
  }
  if (settings.hoursPerDay <= 0) throw new CliError("--hours-per-day must be greater than 0");
  if (settings.accrualHours < 0) throw new CliError("--accrual-hours must be zero or greater");

  db.prepare(`
    UPDATE ptoclaw_settings
    SET balance_hours = ?, accrual_hours = ?, accrual_cadence = ?, hours_per_day = ?, as_of_date = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(
    settings.balanceHours,
    settings.accrualHours,
    settings.accrualCadence,
    settings.hoursPerDay,
    settings.asOfDate,
  );
  return getSettings(db);
}

function setCalendarPreferences(db, options) {
  db.prepare(`
    UPDATE ptoclaw_calendar_preferences
    SET pto_calendar_name = ?,
        pto_event_pattern = ?,
        holiday_calendar_name = ?,
        holiday_event_pattern = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `).run(
    blankToNull(options.ptoCalendarName),
    options.ptoEventPattern,
    blankToNull(options.holidayCalendarName),
    options.holidayEventPattern,
  );
  return getCalendarPreferences(db);
}

function blankToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function deriveOnboardingDraft(options) {
  if (options.balanceHours !== undefined && options.balanceDays !== undefined) {
    throw new CliError("Use either --balance-hours or --balance-days, not both");
  }
  if (options.accrualHours !== undefined && options.accrualDays !== undefined) {
    throw new CliError("Use either --accrual-hours or --accrual-days, not both");
  }
  const hoursPerDay = parseNumber(options.hoursPerDay, "--hours-per-day");
  if (hoursPerDay <= 0) throw new CliError("--hours-per-day must be greater than 0");
  const balanceHours = options.balanceHours !== undefined
    ? parseNumber(options.balanceHours, "--balance-hours")
    : parseNumber(options.balanceDays, "--balance-days") * hoursPerDay;
  const accrualHours = options.accrualHours !== undefined
    ? parseNumber(options.accrualHours, "--accrual-hours")
    : parseNumber(options.accrualDays, "--accrual-days") * hoursPerDay;
  if (balanceHours < 0) throw new CliError("--balance-hours/--balance-days must be zero or greater");
  if (accrualHours < 0) throw new CliError("--accrual-hours/--accrual-days must be zero or greater");
  if (!VALID_CADENCES.has(options.accrualCadence)) {
    throw new CliError("--accrual-cadence must be monthly, semimonthly, biweekly, or weekly");
  }
  return {
    settings: {
      balanceHours,
      accrualHours,
      accrualCadence: options.accrualCadence,
      hoursPerDay,
      asOf: isoDate(parseDate(options.asOf, "--as-of")),
    },
    calendarPreferences: {
      ptoCalendarName: blankToNull(options.ptoCalendar),
      ptoEventPattern: options.ptoEventPattern,
      holidayCalendarName: options.noHolidayCalendar ? null : blankToNull(options.holidayCalendar),
      holidayEventPattern: options.holidayEventPattern,
    },
  };
}

async function buildOnboardingOptions(db, options, globals) {
  const existingSettings = db ? getSettings(db) : defaultSettings();
  const existingPrefs = db ? getCalendarPreferences(db) : defaultCalendarPreferences();
  const promptable = !globals.noInput && process.stdin.isTTY;
  if (!promptable) validateNonInteractiveOnboardingOptions(options);
  const asker = promptable
    ? readline.createInterface({ input: process.stdin, output: process.stderr })
    : null;
  try {
    const withDefault = async (key, label, fallback) => {
      if (options[key] !== undefined) return options[key];
      if (!promptable) {
        throw new CliError(`onboard requires --${fromCamel(key)} when prompts are unavailable`);
      }
      const answer = await asker.question(`${label}${fallback !== undefined && fallback !== null && fallback !== "" ? ` [${fallback}]` : ""}: `);
      return answer.trim() === "" ? String(fallback ?? "") : answer.trim();
    };

    const hoursPerDay = await withDefault("hoursPerDay", "How many PTO hours make one work day?", existingSettings.hours_per_day || 8);
    let balanceHours = options.balanceHours;
    if (balanceHours === undefined && options.balanceDays === undefined) {
      balanceHours = await withDefault("balanceHours", "How many PTO hours do you currently have left?", existingSettings.balance_hours ?? 0);
    }
    let accrualHours = options.accrualHours;
    if (accrualHours === undefined && options.accrualDays === undefined) {
      accrualHours = await withDefault("accrualHours", "How many PTO hours do you accrue per period?", existingSettings.accrual_hours ?? 0);
    }

    return {
      ...options,
      hoursPerDay,
      balanceHours,
      accrualHours,
      accrualCadence: await withDefault("accrualCadence", "Accrual cadence (monthly, semimonthly, biweekly, weekly)", existingSettings.accrual_cadence || "monthly"),
      asOf: await withDefault("asOf", "Current balance as-of date (YYYY-MM-DD)", options.asOf || todayIso()),
      ptoCalendar: await withDefault("ptoCalendar", "Calendar name for PTO/day-off events", existingPrefs.pto_calendar_name || "Calendar"),
      ptoEventPattern: await withDefault("ptoEventPattern", "Text pattern for PTO/day-off events", existingPrefs.pto_event_pattern || "PTO|OOO|Vacation"),
      holidayCalendar: options.noHolidayCalendar ? "" : await withDefault("holidayCalendar", "Calendar name for holidays/office closures (blank if none)", existingPrefs.holiday_calendar_name || ""),
      holidayEventPattern: options.noHolidayCalendar
        ? (options.holidayEventPattern ?? existingPrefs.holiday_event_pattern ?? "Holiday|Office closed")
        : await withDefault("holidayEventPattern", "Text pattern for holidays/office closures", existingPrefs.holiday_event_pattern || "Holiday|Office closed"),
    };
  } finally {
    asker?.close();
  }
}

function validateNonInteractiveOnboardingOptions(options) {
  const missing = [];
  if (options.balanceHours !== undefined && options.balanceDays !== undefined) {
    throw new CliError("Use either --balance-hours or --balance-days, not both");
  }
  if (options.accrualHours !== undefined && options.accrualDays !== undefined) {
    throw new CliError("Use either --accrual-hours or --accrual-days, not both");
  }
  if (options.noHolidayCalendar && options.holidayCalendar !== undefined) {
    throw new CliError("Use either --holiday-calendar or --no-holiday-calendar, not both");
  }
  if (options.balanceHours === undefined && options.balanceDays === undefined) missing.push("--balance-hours or --balance-days");
  if (options.accrualHours === undefined && options.accrualDays === undefined) missing.push("--accrual-hours or --accrual-days");
  for (const key of ["hoursPerDay", "accrualCadence", "asOf", "ptoCalendar", "ptoEventPattern"]) {
    if (options[key] === undefined) missing.push(`--${fromCamel(key)}`);
  }
  if (!options.noHolidayCalendar && options.holidayCalendar === undefined) {
    missing.push("--holiday-calendar or --no-holiday-calendar");
  }
  if (!options.noHolidayCalendar && options.holidayEventPattern === undefined) missing.push("--holiday-event-pattern");
  if (missing.length > 0) {
    throw new CliError(`onboard requires ${missing.join(", ")} when prompts are unavailable`);
  }
}

async function onboard(db, dbPath, options, globals) {
  if (!options.dryRun) initSchema(db, options.asOf || todayIso());
  const completeOptions = await buildOnboardingOptions(db, options, globals);
  const draft = deriveOnboardingDraft(completeOptions);
  if (options.dryRun) {
    return {
      dbPath,
      dryRun: true,
      settings: settingsDraftToRow(draft.settings),
      calendarPreferences: preferencesDraftToRow(draft.calendarPreferences),
    };
  }
  const settings = setSettings(db, draft.settings);
  const calendarPreferences = setCalendarPreferences(db, draft.calendarPreferences);
  return { dbPath, dryRun: false, settings, calendarPreferences };
}

function settingsDraftToRow(settings) {
  return {
    balance_hours: settings.balanceHours,
    accrual_hours: settings.accrualHours,
    accrual_cadence: settings.accrualCadence,
    hours_per_day: settings.hoursPerDay,
    as_of_date: settings.asOf,
  };
}

function preferencesDraftToRow(preferences) {
  return {
    pto_calendar_name: preferences.ptoCalendarName,
    pto_event_pattern: preferences.ptoEventPattern,
    holiday_calendar_name: preferences.holidayCalendarName,
    holiday_event_pattern: preferences.holidayEventPattern,
  };
}

function parseNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new CliError(`${label} must be a number`);
  return number;
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw new CliError(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new CliError(`${label} is not a valid date`);
  }
  return date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return isoDate(new Date());
}

function addDaysIso(value, days) {
  const date = parseDate(value, "date");
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function countWeekdays(start, end) {
  let count = 0;
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function validatePlanOptions(options) {
  for (const key of ["start", "end", "type", "status", "title"]) {
    if (!options[key]) throw new CliError(`plan add requires --${fromCamel(key)}`);
  }
  const start = parseDate(options.start, "--start");
  const end = parseDate(options.end, "--end");
  if (end < start) throw new CliError("--end must be on or after --start");
  if (!VALID_TYPES.has(options.type)) {
    throw new CliError("--type must be vacation, sick, holiday, or personal");
  }
  if (!VALID_STATUSES.has(options.status)) {
    throw new CliError("--status must be planned or tentative");
  }
  return { start, end };
}

function buildPlanDraft(settings, options) {
  const { start, end } = validatePlanOptions(options);
  const workdayCount = countWeekdays(start, end);
  const totalHours = CONSUMING_TYPES.has(options.type) ? workdayCount * settings.hours_per_day : 0;
  return {
    start_date: isoDate(start),
    end_date: isoDate(end),
    type: options.type,
    status: options.status,
    title: options.title,
    notes: options.notes || null,
    hours_per_day: settings.hours_per_day,
    workday_count: workdayCount,
    total_hours: totalHours,
  };
}

function insertPlan(db, draft) {
  const result = db.prepare(`
    INSERT INTO ptoclaw_plans (
      start_date, end_date, type, status, title, notes, hours_per_day, workday_count, total_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draft.start_date,
    draft.end_date,
    draft.type,
    draft.status,
    draft.title,
    draft.notes,
    draft.hours_per_day,
    draft.workday_count,
    draft.total_hours,
  );
  const id = Number(result.lastInsertRowid);
  const externalId = calendarExternalId({ id, ...draft });
  db.prepare("UPDATE ptoclaw_plans SET calendar_external_id = ?, updated_at = datetime('now') WHERE id = ?").run(externalId, id);
  db.prepare(`
    INSERT OR REPLACE INTO ptoclaw_calendar_sync (plan_id, external_id, last_action, updated_at)
    VALUES (?, ?, 'pending', datetime('now'))
  `).run(id, externalId);
  return getPlan(db, id);
}

function calendarExternalId(plan) {
  return `ptoclaw:${plan.id}:${plan.start_date}:${plan.end_date}`;
}

function getPlan(db, id) {
  return db.prepare("SELECT * FROM ptoclaw_plans WHERE id = ?").get(id);
}

function listPlans(db, options = {}) {
  if (options.upcoming) {
    const asOf = options.asOf || todayIso();
    return db
      .prepare("SELECT * FROM ptoclaw_plans WHERE end_date >= ? ORDER BY start_date, id")
      .all(asOf);
  }
  return db.prepare("SELECT * FROM ptoclaw_plans ORDER BY start_date, id").all();
}

function removePlan(db, id, options) {
  const plan = getPlan(db, id);
  if (!plan) throw new CliError(`No plan found with id ${id}`);
  if (!options.force && !options.dryRun) {
    throw new CliError("Refusing to remove without --force or --dry-run");
  }
  if (!options.dryRun) {
    db.prepare("DELETE FROM ptoclaw_plans WHERE id = ?").run(id);
  }
  return plan;
}

function accrualPeriodsBetween(cadence, asOf, through) {
  if (through < asOf) return 0;
  const days = Math.floor((through.getTime() - asOf.getTime()) / DAY_MS);
  if (cadence === "weekly") return Math.floor(days / 7);
  if (cadence === "biweekly") return Math.floor(days / 14);
  if (cadence === "semimonthly") return wholeSemiMonthsUntil(asOf, through);
  return wholeMonthsUntil(asOf, through);
}

function wholeMonthsUntil(asOf, through) {
  const monthDelta = (through.getUTCFullYear() - asOf.getUTCFullYear()) * 12 + (through.getUTCMonth() - asOf.getUTCMonth());
  if (monthDelta <= 0) return 0;
  return through.getUTCDate() >= asOf.getUTCDate() ? monthDelta : monthDelta - 1;
}

function wholeSemiMonthsUntil(asOf, through) {
  let periods = 0;
  for (let cursor = nextSemiMonthlyDate(asOf); cursor <= through; cursor = nextSemiMonthlyDate(cursor)) {
    periods += 1;
  }
  return periods;
}

function nextSemiMonthlyDate(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (day < 15) return new Date(Date.UTC(year, month, 15));
  return new Date(Date.UTC(year, month + 1, 1));
}

function plannedHoursThrough(db, throughIso, asOfIso) {
  const rows = db.prepare(`
    SELECT start_date, end_date, hours_per_day
    FROM ptoclaw_plans
    WHERE status = 'planned'
      AND type IN ('vacation', 'sick', 'personal')
      AND start_date <= ?
      AND end_date >= ?
  `).all(throughIso, asOfIso);
  return rows.reduce((total, plan) => {
    const overlapStart = plan.start_date > asOfIso ? plan.start_date : asOfIso;
    const overlapEnd = plan.end_date < throughIso ? plan.end_date : throughIso;
    return total + countWeekdays(parseDate(overlapStart, "plan start"), parseDate(overlapEnd, "plan end")) * plan.hours_per_day;
  }, 0);
}

function forecast(db, throughValue, options = {}) {
  const through = parseDate(throughValue, "--through");
  const throughIso = isoDate(through);
  const settings = getSettings(db);
  const asOfIso = options.asOf ? isoDate(parseDate(options.asOf, "--as-of")) : settings.as_of_date;
  const asOf = parseDate(asOfIso, "--as-of");
  const accrualPeriods = accrualPeriodsBetween(settings.accrual_cadence, asOf, through);
  const accruedHours = accrualPeriods * settings.accrual_hours;
  const plannedHours = plannedHoursThrough(db, throughIso, asOfIso);
  const endingBalanceHours = settings.balance_hours + accruedHours - plannedHours;
  return {
    through: throughIso,
    asOf: asOfIso,
    startingBalanceHours: settings.balance_hours,
    accrualCadence: settings.accrual_cadence,
    accrualPeriods,
    accruedHours,
    plannedHours,
    endingBalanceHours,
    endingBalanceDays: settings.hours_per_day ? endingBalanceHours / settings.hours_per_day : null,
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseYear(value, label = "--year") {
  if (!/^\d{4}$/.test(value || "")) throw new CliError(`${label} must use YYYY`);
  const year = Number(value);
  if (year < 1900 || year > 9999) throw new CliError(`${label} must be between 1900 and 9999`);
  return year;
}

function monthStartIso(year, monthIndex) {
  return isoDate(new Date(Date.UTC(year, monthIndex, 1)));
}

function monthEndIso(year, monthIndex) {
  return isoDate(new Date(Date.UTC(year, monthIndex + 1, 0)));
}

function maxIsoDate(left, right) {
  return left > right ? left : right;
}

function projectionThrough(db, throughIso, settings, asOfIso) {
  if (throughIso <= asOfIso) {
    return {
      accrualPeriods: 0,
      accruedHours: 0,
      plannedHours: 0,
      balanceHours: settings.balance_hours,
      balanceDays: settings.hours_per_day ? settings.balance_hours / settings.hours_per_day : null,
    };
  }
  const accrualPeriods = accrualPeriodsBetween(
    settings.accrual_cadence,
    parseDate(asOfIso, "--as-of"),
    parseDate(throughIso, "month end"),
  );
  const accruedHours = accrualPeriods * settings.accrual_hours;
  const plannedHours = plannedHoursThrough(db, throughIso, asOfIso);
  const balanceHours = settings.balance_hours + accruedHours - plannedHours;
  return {
    accrualPeriods,
    accruedHours,
    plannedHours,
    balanceHours,
    balanceDays: settings.hours_per_day ? balanceHours / settings.hours_per_day : null,
  };
}

function plannedHoursInRange(db, startIso, endIso) {
  if (endIso < startIso) return 0;
  const rows = db.prepare(`
    SELECT start_date, end_date, hours_per_day
    FROM ptoclaw_plans
    WHERE status = 'planned'
      AND type IN ('vacation', 'sick', 'personal')
      AND start_date <= ?
      AND end_date >= ?
  `).all(endIso, startIso);
  return rows.reduce((total, plan) => {
    const overlapStart = maxIsoDate(plan.start_date, startIso);
    const overlapEnd = plan.end_date < endIso ? plan.end_date : endIso;
    return total + countWeekdays(parseDate(overlapStart, "plan start"), parseDate(overlapEnd, "plan end")) * plan.hours_per_day;
  }, 0);
}

function nonPtoDaysInRange(db, startIso, endIso) {
  if (endIso < startIso) return { nonPtoDays: 0, holidayCount: 0 };
  const rows = db.prepare(`
    SELECT start_date, end_date, type
    FROM ptoclaw_plans
    WHERE status = 'planned'
      AND type NOT IN ('vacation', 'sick', 'personal')
      AND start_date <= ?
      AND end_date >= ?
  `).all(endIso, startIso);
  return rows.reduce((total, plan) => {
    const overlapStart = maxIsoDate(plan.start_date, startIso);
    const overlapEnd = plan.end_date < endIso ? plan.end_date : endIso;
    total.nonPtoDays += countWeekdays(parseDate(overlapStart, "plan start"), parseDate(overlapEnd, "plan end"));
    if (plan.type === "holiday") total.holidayCount += 1;
    return total;
  }, { nonPtoDays: 0, holidayCount: 0 });
}

function levelForDays(days) {
  const safeDays = Number.isFinite(days) ? days : 0;
  const filled = Math.max(0, Math.min(5, Math.ceil(safeDays / 3)));
  const bar = `${"#".repeat(filled)}${".".repeat(5 - filled)}`;
  if (safeDays <= 0) return { level: "empty", indicator: `🔴 [${bar}]` };
  if (safeDays < 2) return { level: "low", indicator: `🔴 [${bar}]` };
  if (safeDays < 5) return { level: "light", indicator: `🟠 [${bar}]` };
  if (safeDays < 10) return { level: "steady", indicator: `🟡 [${bar}]` };
  if (safeDays < 15) return { level: "strong", indicator: `🟢 [${bar}]` };
  return { level: "full", indicator: `🟢 [${bar}]` };
}

function monthlySummary(db, options = {}) {
  const settings = getSettings(db);
  const asOf = options.asOf ? isoDate(parseDate(options.asOf, "--as-of")) : settings.as_of_date;
  const year = options.year ? parseYear(options.year) : parseYear(asOf.slice(0, 4), "as-of year");
  const months = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const start = monthStartIso(year, monthIndex);
    const end = monthEndIso(year, monthIndex);
    const startingProjection = start <= asOf
      ? projectionThrough(db, asOf, settings, asOf)
      : projectionThrough(db, addDaysIso(start, -1), settings, asOf);
    const endingProjection = projectionThrough(db, end, settings, asOf);
    const reportingStart = maxIsoDate(start, asOf);
    const accruedHours = endingProjection.accruedHours - startingProjection.accruedHours;
    const plannedPtoHours = plannedHoursInRange(db, reportingStart, end);
    const nonPto = nonPtoDaysInRange(db, reportingStart, end);
    const endingBalanceDays = settings.hours_per_day ? endingProjection.balanceHours / settings.hours_per_day : null;
    const level = levelForDays(endingBalanceDays);
    months.push({
      month: MONTH_NAMES[monthIndex],
      monthNumber: monthIndex + 1,
      start,
      end,
      startingBalanceHours: startingProjection.balanceHours,
      startingBalanceDays: settings.hours_per_day ? startingProjection.balanceHours / settings.hours_per_day : null,
      endingBalanceHours: endingProjection.balanceHours,
      endingBalanceDays,
      accruedHours,
      plannedPtoHours,
      plannedPtoDays: settings.hours_per_day ? plannedPtoHours / settings.hours_per_day : null,
      nonPtoDays: nonPto.nonPtoDays,
      holidayCount: nonPto.holidayCount,
      level: level.level,
      indicator: level.indicator,
    });
  }

  const totals = months.reduce((sum, month) => {
    sum.accruedHours += month.accruedHours;
    sum.plannedPtoHours += month.plannedPtoHours;
    sum.nonPtoDays += month.nonPtoDays;
    sum.holidayCount += month.holidayCount;
    return sum;
  }, { accruedHours: 0, plannedPtoHours: 0, nonPtoDays: 0, holidayCount: 0 });

  return {
    year,
    asOf,
    settings: {
      accrualCadence: settings.accrual_cadence,
      accrualHours: settings.accrual_hours,
      hoursPerDay: settings.hours_per_day,
    },
    months,
    totals: {
      ...totals,
      accruedDays: settings.hours_per_day ? totals.accruedHours / settings.hours_per_day : null,
      plannedPtoDays: settings.hours_per_day ? totals.plannedPtoHours / settings.hours_per_day : null,
    },
  };
}

function status(db, dbPath, options = {}) {
  const settings = getSettings(db);
  const asOf = options.asOf ? isoDate(parseDate(options.asOf, "--as-of")) : settings.as_of_date;
  const planned = plannedHoursThrough(db, "9999-12-31", asOf);
  const upcoming = listPlans(db, { upcoming: true, asOf });
  const yearEnd = `${asOf.slice(0, 4)}-12-31`;
  return {
    dbPath,
    asOf,
    settings,
    currentBalanceHours: settings.balance_hours,
    currentBalanceDays: settings.hours_per_day ? settings.balance_hours / settings.hours_per_day : null,
    plannedPtoHours: planned,
    plannedPtoDays: settings.hours_per_day ? planned / settings.hours_per_day : null,
    upcomingPlans: upcoming.length,
    forecast: forecast(db, yearEnd, { asOf }),
  };
}

function calendarDryRun(db) {
  return listPlans(db, { upcoming: true }).map((plan) => ({
    action: "upsert",
    provider: "apple-calendar",
    externalId: plan.calendar_external_id || calendarExternalId(plan),
    title: plan.title,
    startDate: plan.start_date,
    endDate: addDaysIso(plan.end_date, 1),
    allDay: true,
    notes: plan.notes,
    sourcePlanId: plan.id,
    status: plan.status,
    type: plan.type,
  }));
}

function dbStats(db, dbPath) {
  const planCount = db.prepare("SELECT COUNT(*) AS count FROM ptoclaw_plans").get().count;
  const syncCount = db.prepare("SELECT COUNT(*) AS count FROM ptoclaw_calendar_sync").get().count;
  const settings = getSettings(db);
  const stat = fs.statSync(dbPath);
  return {
    dbPath,
    schemaVersion: db.prepare("SELECT value FROM ptoclaw_meta WHERE key = 'schema_version'").get()?.value || null,
    planCount,
    calendarSyncRows: syncCount,
    sizeBytes: stat.size,
    settingsUpdatedAt: settings.updated_at,
  };
}

function print(value, globals) {
  if (globals.json || value.json) {
    const { json, ...payload } = value;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(formatHuman(value));
}

function formatHuman(value) {
  switch (value.kind) {
    case "init":
      return `Initialized ptoclaw database\nDB: ${value.dbPath}`;
    case "settings":
      return [
        "Settings updated",
        `As of: ${value.settings.as_of_date}`,
        `Balance: ${fmtHours(value.settings.balance_hours)}`,
        `Accrual: ${fmtHours(value.settings.accrual_hours)} ${value.settings.accrual_cadence}`,
        `Hours/day: ${fmt(value.settings.hours_per_day)}`,
      ].join("\n");
    case "onboard":
      return [
        value.dryRun ? "Onboarding dry run" : "PTOClaw onboarding complete",
        `DB: ${value.dbPath}`,
        `Balance: ${fmtHours(value.settings.balance_hours)} (${fmt(value.settings.balance_hours / value.settings.hours_per_day)} days)`,
        `Accrual: ${fmtHours(value.settings.accrual_hours)} ${value.settings.accrual_cadence}`,
        `Hours/day: ${fmt(value.settings.hours_per_day)}`,
        `As of: ${value.settings.as_of_date}`,
        `PTO calendar: ${value.calendarPreferences.pto_calendar_name || "not set"}`,
        `PTO pattern: ${value.calendarPreferences.pto_event_pattern}`,
        `Holiday calendar: ${value.calendarPreferences.holiday_calendar_name || "not set"}`,
        `Holiday pattern: ${value.calendarPreferences.holiday_event_pattern}`,
      ].join("\n");
    case "status":
      return [
        `DB: ${value.dbPath}`,
        `As of: ${value.asOf}`,
        `Balance: ${fmtHours(value.currentBalanceHours)} (${fmt(value.currentBalanceDays)} days)`,
        `Planned PTO: ${fmtHours(value.plannedPtoHours)} (${fmt(value.plannedPtoDays)} days)`,
        `Upcoming plans: ${value.upcomingPlans}`,
        `Forecast through ${value.forecast.through}: ${fmtHours(value.forecast.endingBalanceHours)} (${fmt(value.forecast.endingBalanceDays)} days)`,
      ].join("\n");
    case "plan-add":
      return [
        value.dryRun ? "Plan add dry run" : `Added plan #${value.plan.id}`,
        `${value.plan.title}: ${value.plan.start_date} to ${value.plan.end_date}`,
        `Type/status: ${value.plan.type}/${value.plan.status}`,
        `PTO impact: ${fmtHours(value.plan.total_hours)} (${value.plan.workday_count} weekdays)`,
        `Calendar external ID: ${value.plan.calendar_external_id || value.plan.preview_calendar_external_id}`,
      ].join("\n");
    case "plan-list":
      if (value.plans.length === 0) return "No plans found.";
      return value.plans.map(formatPlanLine).join("\n");
    case "plan-remove":
      return `${value.dryRun ? "Would remove" : "Removed"} plan #${value.plan.id}: ${value.plan.title}`;
    case "forecast":
      return [
        `Forecast from ${value.asOf} through ${value.through}`,
        `Starting balance: ${fmtHours(value.startingBalanceHours)}`,
        `Accrual: ${fmtHours(value.accruedHours)} across ${value.accrualPeriods} ${value.accrualCadence} periods`,
        `Planned PTO: ${fmtHours(value.plannedHours)}`,
        `Ending balance: ${fmtHours(value.endingBalanceHours)} (${fmt(value.endingBalanceDays)} days)`,
      ].join("\n");
    case "summary-months":
      return formatMonthlySummary(value);
    case "calendar":
      if (value.events.length === 0) return "No upcoming plans to sync.";
      return value.events.map((event) => {
        return `Would ${event.action} ${event.externalId}: ${event.title} (${event.startDate} to ${event.endDate}, all-day)`;
      }).join("\n");
    case "db-stats":
      return [
        `DB: ${value.dbPath}`,
        `Schema: ${value.schemaVersion}`,
        `Plans: ${value.planCount}`,
        `Calendar sync rows: ${value.calendarSyncRows}`,
        `Size: ${value.sizeBytes} bytes`,
      ].join("\n");
    default:
      return JSON.stringify(value, null, 2);
  }
}

function formatMonthlySummary(value) {
  const lines = [
    `PTO by month ${value.year} (as of ${value.asOf})`,
  ];
  for (const month of value.months) {
    const parts = [
      `${month.month.slice(0, 3)} ${month.indicator}`,
      `${fmt(month.startingBalanceDays)}d -> ${fmt(month.endingBalanceDays)}d`,
      `(+${fmt(month.accruedHours / value.settings.hoursPerDay)}d, -${fmt(month.plannedPtoDays)}d)`,
    ];
    if (month.nonPtoDays > 0) parts.push(`${fmt(month.nonPtoDays)} non-PTOd`);
    lines.push(parts.join(" "));
  }
  lines.push(`Totals: +${fmt(value.totals.accruedDays)}d accrued, -${fmt(value.totals.plannedPtoDays)}d planned PTO, ${fmt(value.totals.nonPtoDays)} non-PTOd`);
  return lines.join("\n");
}

function formatPlanLine(plan) {
  return `#${plan.id} ${plan.start_date}..${plan.end_date} ${plan.type}/${plan.status} ${plan.title} (${fmtHours(plan.total_hours)})`;
}

function fmtHours(value) {
  return `${fmt(value)}h`;
}

function fmt(value) {
  if (value === null || value === undefined) return "n/a";
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

async function main() {
  const { globals, rest } = parseArgv(process.argv.slice(2));
  if (globals.version) {
    console.log(VERSION);
    return;
  }
  if (globals.help || rest.length === 0) {
    console.log(usage());
    return;
  }

  const command = rest[0];
  const usesSubcommand = new Set(["settings", "plan", "summary", "calendar", "db"]).has(command);
  const subcommand = usesSubcommand ? rest[1] : undefined;
  const commandArgs = usesSubcommand ? rest.slice(2) : rest.slice(1);
  const { positionals, options } = parseOptions(commandArgs);
  if (options.json) globals.json = true;
  resolveGlobalDb(globals);
  await maybePromptForOnboardingDb(command, globals);
  const resolvedDbPath = expandPath(globals.db);
  const shouldAvoidDbCreate = command === "onboard" && options.dryRun && !fs.existsSync(resolvedDbPath);
  const { db, dbPath } = shouldAvoidDbCreate
    ? { db: null, dbPath: resolvedDbPath }
    : openDb(globals.db);

  try {
    if (command === "init") {
      initSchema(db);
      print({ kind: "init", ok: true, dbPath }, globals);
      return;
    }

    if (command === "onboard") {
      const result = await onboard(db, dbPath, options, globals);
      if (!options.dryRun && ["flag", "prompt"].includes(globals.dbSource)) {
        result.configPath = saveDbPathConfig(dbPath);
      }
      print({ kind: "onboard", ok: true, ...result }, globals);
      return;
    }

    requireSchema(db);

    if (command === "status") {
      print({ kind: "status", ...status(db, dbPath, options) }, globals);
    } else if (command === "settings" && subcommand === "set") {
      const settings = setSettings(db, options);
      print({ kind: "settings", ok: true, settings }, globals);
    } else if (command === "plan" && subcommand === "add") {
      const draft = buildPlanDraft(getSettings(db), options);
      const plan = options.dryRun
        ? { id: null, ...draft, calendar_external_id: null, preview_calendar_external_id: calendarExternalId({ id: "pending", ...draft }) }
        : insertPlan(db, draft);
      print({ kind: "plan-add", dryRun: Boolean(options.dryRun), plan }, globals);
    } else if (command === "plan" && subcommand === "list") {
      print({ kind: "plan-list", upcoming: Boolean(options.upcoming), plans: listPlans(db, options) }, globals);
    } else if (command === "plan" && subcommand === "remove") {
      const id = Number(positionals[0]);
      if (!Number.isInteger(id) || id <= 0) throw new CliError("plan remove requires a numeric <id>");
      const plan = removePlan(db, id, options);
      print({ kind: "plan-remove", dryRun: Boolean(options.dryRun), plan }, globals);
    } else if (command === "forecast") {
      if (!options.through) throw new CliError("forecast requires --through YYYY-MM-DD");
      print({ kind: "forecast", ...forecast(db, options.through, options) }, globals);
    } else if (command === "summary" && subcommand === "months") {
      print({ kind: "summary-months", ...monthlySummary(db, options) }, globals);
    } else if (command === "calendar" && subcommand === "sync") {
      if (!options.dryRun) {
        throw new CliError("calendar sync is currently dry-run only. Re-run with --dry-run.");
      }
      print({ kind: "calendar", dryRun: true, events: calendarDryRun(db) }, globals);
    } else if (command === "db" && subcommand === "stats") {
      print({ kind: "db-stats", ...dbStats(db, dbPath) }, globals);
    } else {
      throw new CliError(`Unknown command: ${rest.join(" ")}`);
    }
  } finally {
    db?.close();
  }
}

main().catch((error) => {
  const code = error instanceof CliError ? error.code : 1;
  const payload = { ok: false, error: error.message };
  if (process.argv.includes("--json")) {
    console.error(JSON.stringify(payload, null, 2));
  } else {
    console.error(`ptoclaw: ${error.message}`);
  }
  process.exit(code);
});
