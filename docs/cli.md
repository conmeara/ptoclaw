# CLI

```text
ptoclaw [--db PATH] [--json] [--no-input] [--verbose] <command>
```

Global options may appear before the command. `plan list`, `summary months`, and `calendar sync` also accept command-local `--json` for convenience.

`--db PATH` selects the SQLite database for that invocation. Without it, PTOClaw checks `PTOCLAW_DB`, then the saved onboarding config at `~/.config/ptoclaw/config.json` or `$XDG_CONFIG_HOME/ptoclaw/config.json`, then the local default `~/.local/share/ptoclaw/ptoclaw.sqlite`.

## Commands

```bash
ptoclaw init
ptoclaw onboard [--balance-hours N|--balance-days N] [--accrual-hours N|--accrual-days N] [--accrual-cadence monthly|semimonthly|biweekly|weekly] [--hours-per-day N] [--as-of YYYY-MM-DD] [--pto-calendar TEXT] [--pto-event-pattern TEXT] [--holiday-calendar TEXT|--no-holiday-calendar] [--holiday-event-pattern TEXT] [--dry-run]
ptoclaw status [--as-of YYYY-MM-DD]
ptoclaw settings set --balance-hours N --accrual-hours N --accrual-cadence monthly|semimonthly|biweekly|weekly --hours-per-day N [--as-of YYYY-MM-DD]
ptoclaw plan add --start YYYY-MM-DD --end YYYY-MM-DD --type vacation|sick|holiday|personal --status planned|tentative --title TEXT [--notes TEXT] [--dry-run]
ptoclaw plan list [--upcoming] [--json]
ptoclaw plan remove <id> [--force|--dry-run]
ptoclaw forecast --through YYYY-MM-DD [--as-of YYYY-MM-DD]
ptoclaw summary months [--year YYYY] [--as-of YYYY-MM-DD] [--json]
ptoclaw calendar sync --dry-run [--json]
ptoclaw db stats
```

## Onboarding

`ptoclaw onboard` initializes the database if needed, then saves:

- current PTO balance, in hours or days
- accrual amount and cadence
- hours per PTO day
- balance as-of date
- calendar name/pattern for PTO or other days off
- calendar name/pattern for holidays or office closures

When stdin is a TTY, missing values are prompted for. For agent or script usage, pass all required values and `--no-input`. Use `--no-holiday-calendar` when holidays are not tracked on a separate calendar; no holiday pattern is required in that mode.

If no `--db`, `PTOCLAW_DB`, or saved config exists, interactive onboarding prompts for the SQLite DB path before opening or creating it. Non-interactive onboarding can persist a DB choice by passing global `--db PATH`; dry runs never create a database or config file.

Example:

```bash
ptoclaw --db /path/to/personal-data.sqlite onboard --balance-days 10 --accrual-days 1 --accrual-cadence monthly --hours-per-day 8 --as-of 2026-01-01 --pto-calendar "Calendar" --pto-event-pattern "PTO|OOO|Vacation" --holiday-calendar "US Holidays" --holiday-event-pattern "Holiday|Office closed" --no-input
ptoclaw onboard --balance-days 10 --accrual-days 1 --accrual-cadence monthly --hours-per-day 8 --as-of 2026-01-01 --pto-calendar "Calendar" --pto-event-pattern "PTO|OOO|Vacation" --holiday-calendar "US Holidays" --holiday-event-pattern "Holiday|Office closed" --no-input
```

## Forecasting

Forecasts start from the saved `balance_hours` as of `ptoclaw_settings.as_of_date`. Use `--as-of` on `status` or `forecast` to run a repeatable forecast from another date.

Planned `vacation`, `sick`, and `personal` plans consume PTO when `status = planned`. `holiday` plans are listed and synced, but their `total_hours` is zero.

## Message Summaries

`ptoclaw summary months` prints a compact, message-native year view that can be pasted directly into Telegram, SMS, or plain text. It shows one row per month with a simple level indicator, starting and ending balance in days, accrued PTO, planned PTO consumption, and non-PTO days such as holidays.

Example:

```bash
ptoclaw summary months --year 2026 --as-of 2026-01-01
```

Human output intentionally avoids markdown tables. Use it for direct chat replies. Use `--json` when another tool or workflow needs structured data:

```bash
ptoclaw --json summary months --year 2026 --as-of 2026-01-01
```

The JSON payload includes `months[]` entries with `month`, `start`, `end`, starting and ending balances in hours and days, accrued hours, planned PTO hours and days, `nonPtoDays`, `holidayCount`, `level`, and `indicator`. The command only reads PTOClaw's SQLite database; it does not inspect calendars or create events.
