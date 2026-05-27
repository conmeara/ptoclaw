# Schema

PTOClaw uses namespaced tables so it can share a SQLite database with other local-first tools.

## `ptoclaw_meta`

Key/value metadata. `schema_version` is currently `2`.

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

## `ptoclaw_calendar_preferences`

Single-row calendar setup captured during onboarding:

- `pto_calendar_name`
- `pto_event_pattern`
- `holiday_calendar_name`
- `holiday_event_pattern`

These values describe how the user already tracks days off and holidays on their calendar. Calendar writes and imports are still dry-run/planned behavior.
