# Privacy Policy

PTOClaw is local-first software. It does not include telemetry, analytics, network calls, hosted services, or background uploads.

PTO data is stored in a SQLite database on the user's machine. By default this is `~/.local/share/ptoclaw/ptoclaw.sqlite`, unless the user provides `PTOCLAW_DB` or `--db PATH`.

Calendar sync is dry-run only in this release. The CLI can print proposed calendar events, but it does not write to Apple Calendar or any other external calendar service.

Users are responsible for protecting their local SQLite database and backups.
