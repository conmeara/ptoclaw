# CLI

```text
ptoclaw [--db PATH] [--json] [--no-input] [--verbose] <command>
```

Global options may appear before the command. `plan list` and `calendar sync` also accept command-local `--json` for convenience.

## Commands

```bash
ptoclaw init
ptoclaw status [--as-of YYYY-MM-DD]
ptoclaw settings set --balance-hours N --accrual-hours N --accrual-cadence monthly|semimonthly|biweekly|weekly --hours-per-day N [--as-of YYYY-MM-DD]
ptoclaw plan add --start YYYY-MM-DD --end YYYY-MM-DD --type vacation|sick|holiday|personal --status planned|tentative --title TEXT [--notes TEXT] [--dry-run]
ptoclaw plan list [--upcoming] [--json]
ptoclaw plan remove <id> [--force|--dry-run]
ptoclaw forecast --through YYYY-MM-DD [--as-of YYYY-MM-DD]
ptoclaw calendar sync --dry-run [--json]
ptoclaw db stats
```

## Forecasting

Forecasts start from the saved `balance_hours` as of `ptoclaw_settings.as_of_date`. Use `--as-of` on `status` or `forecast` to run a repeatable forecast from another date.

Planned `vacation`, `sick`, and `personal` plans consume PTO when `status = planned`. `holiday` plans are listed and synced, but their `total_hours` is zero.
