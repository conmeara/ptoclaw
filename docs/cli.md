# CLI

```text
ptoclaw [--db PATH] [--json] [--no-input] [--verbose] <command>
```

Global options may appear before the command. `plan list` and `calendar sync` also accept command-local `--json` for convenience.

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

Example:

```bash
ptoclaw onboard --balance-days 10 --accrual-days 1 --accrual-cadence monthly --hours-per-day 8 --as-of 2026-01-01 --pto-calendar "Calendar" --pto-event-pattern "PTO|OOO|Vacation" --holiday-calendar "US Holidays" --holiday-event-pattern "Holiday|Office closed" --no-input
```

## Forecasting

Forecasts start from the saved `balance_hours` as of `ptoclaw_settings.as_of_date`. Use `--as-of` on `status` or `forecast` to run a repeatable forecast from another date.

Planned `vacation`, `sick`, and `personal` plans consume PTO when `status = planned`. `holiday` plans are listed and synced, but their `total_hours` is zero.
