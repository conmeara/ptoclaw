---
name: ptoclaw
description: Manage PTO from the local PTOClaw plugin and CLI, including PTO balance, accrual settings, planned time off, forecasts, and calendar sync dry-runs.
---

# PTOClaw

Use this skill when the user asks to manage PTO from the local PTOClaw plugin, inspect PTO balance, add or remove planned time off, forecast PTO, or preview calendar sync.

## Default Behavior

- Use the plugin CLI through `ptoclaw` when it is installed, or `node bin/ptoclaw.mjs` from this repo during development.
- Keep SQLite as the source of truth. Do not hardcode private paths, account names, calendars, emails, or personal data.
- Use `PTOCLAW_DB` or `--db PATH` when the user wants an external database. Otherwise, use the CLI default user-local path.
- Prefer human-readable output for direct user answers. Use `--json` when another tool or automation will consume the result.
- Treat calendar sync as an external side effect. `calendar sync` is dry-run only in this release and must be run with `--dry-run`.

## Common Commands

Initialize storage:

```bash
ptoclaw init
```

Run first-time onboarding:

```bash
ptoclaw onboard
```

For non-interactive agent setup, provide all values explicitly:

```bash
ptoclaw onboard --balance-days 10 --accrual-days 1 --accrual-cadence monthly --hours-per-day 8 --as-of 2026-01-01 --pto-calendar "Calendar" --pto-event-pattern "PTO|OOO|Vacation" --holiday-calendar "US Holidays" --holiday-event-pattern "Holiday|Office closed" --no-input
```

Use `--no-holiday-calendar` instead of `--holiday-calendar` when holidays are not tracked on a separate calendar. In that mode, do not require `--holiday-event-pattern`.

Show current status:

```bash
ptoclaw status
```

Configure balance and accrual:

```bash
ptoclaw settings set --balance-hours 80 --accrual-hours 8 --accrual-cadence monthly --hours-per-day 8 --as-of 2026-01-01
```

Add planned PTO:

```bash
ptoclaw plan add --start 2026-07-06 --end 2026-07-10 --type vacation --status planned --title "Summer break"
```

Preview calendar sync:

```bash
ptoclaw calendar sync --dry-run --json
```

## Safety

- Use `plan add --dry-run` to preview inserts without writing.
- `plan remove <id>` refuses to delete unless `--force` or `--dry-run` is present.
- Calendar writes are intentionally not implemented yet. The dry-run output includes stable `externalId` values for a future Apple Calendar adapter.
