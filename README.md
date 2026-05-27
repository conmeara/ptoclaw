# PTOClaw

PTOClaw is a small local-first PTO planner for OpenClaw users. It ships as a standalone CLI plus plugin metadata, stores its state in SQLite, and keeps calendar integration dry-run only until a real adapter is added.

## Install

```bash
npm install -g github:conmeara/ptoclaw
ptoclaw init
```

From a checkout:

```bash
npm link
npm test
npm run smoke
ptoclaw init
```

For development without linking:

```bash
npm install
node bin/ptoclaw.mjs init
```

The package has no runtime dependencies. It requires Node 24 or newer for the built-in `node:sqlite` module. If it is later published to npm, `npm install -g ptoclaw` will work as the stable install path.

## Storage

By default, PTOClaw uses:

```text
~/.local/share/ptoclaw/ptoclaw.sqlite
```

Override the database with either:

```bash
PTOCLAW_DB=/path/to/ptoclaw.sqlite ptoclaw status
ptoclaw --db /path/to/ptoclaw.sqlite status
```

All tables are prefixed with `ptoclaw_`, so the schema is safe to colocate in another SQLite database. Users who keep OpenClaw personal data in SQLite can point PTOClaw at that database if they want PTO state to live beside other local data.

## Quick Start

```bash
ptoclaw init
ptoclaw settings set --balance-hours 80 --accrual-hours 8 --accrual-cadence monthly --hours-per-day 8 --as-of 2026-01-01
ptoclaw status
ptoclaw plan add --start 2026-07-06 --end 2026-07-10 --type vacation --status planned --title "Summer break"
ptoclaw forecast --through 2026-12-31 --as-of 2026-01-01
ptoclaw calendar sync --dry-run --json
```

Useful commands:

```bash
ptoclaw plan list --upcoming
ptoclaw plan add --start 2026-11-25 --end 2026-11-27 --type holiday --status planned --title "Office closed" --dry-run
ptoclaw plan remove 1 --dry-run
ptoclaw plan remove 1 --force
ptoclaw db stats
```

## Safety

PTOClaw is intentionally conservative:

- `plan add --dry-run` previews the plan and PTO impact without writing.
- `plan remove <id>` refuses to delete unless `--dry-run` or `--force` is present.
- `calendar sync` requires `--dry-run`. It emits proposed all-day events and stable external IDs, but does not write to Apple Calendar or any other calendar.

## OpenClaw Behavior

The plugin metadata lives in:

- `.codex-plugin/plugin.json`
- `openclaw.plugin.json`
- `skills/ptoclaw/SKILL.md`

The skill tells OpenClaw agents to use the CLI as the primary interface, keep SQLite as the source of truth, avoid private defaults, prefer JSON for automation, and treat calendar sync as dry-run only.

## Current Limits

- Weekends are excluded from PTO hour counts; custom holidays and work schedules are not modeled yet.
- Accrual forecasting is deterministic and local. It uses the configured balance as of `settings.as_of_date` or the command's `--as-of` override.
- Calendar sync only previews events. The stable `externalId` field is reserved for a future Apple Calendar adapter.

## Development

```bash
npm test
npm run smoke
node bin/ptoclaw.mjs --help
git diff --check
```

See [docs/cli.md](docs/cli.md) and [docs/schema.md](docs/schema.md) for command and schema details.
