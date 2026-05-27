# Schema

PTOClaw uses namespaced tables so it can share a SQLite database with other local-first tools.

## `ptoclaw_meta`

Key/value metadata. `schema_version` is currently `1`.

## `ptoclaw_settings`

Single-row settings table:

- `balance_hours`
- `accrual_hours`
- `accrual_cadence`
- `hours_per_day`
- `as_of_date`

## `ptoclaw_plans`

Stores planned PTO windows, title/notes, computed weekday count, total PTO hours, and `calendar_external_id`.

## `ptoclaw_calendar_sync`

Tracks the stable external ID and future sync state for each plan. Calendar writes are not implemented yet; this table is prepared for a future adapter.
