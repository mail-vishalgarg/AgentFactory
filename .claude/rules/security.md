# Security Rules

1. **Never commit secrets** — no API keys, passwords, tokens, or credentials in any tracked file. Use `.env` (gitignored) exclusively.
2. **Read config from environment only** — use `os.getenv()` or Pydantic `BaseSettings`; never hardcode values.
3. **Hash API keys, never store raw** — if storing user-provided keys in the DB, hash with bcrypt or store encrypted; log only a masked prefix.
4. **Validate all external input** — every incoming HTTP body must pass through a Pydantic model; reject unexpected fields with `model_config = ConfigDict(extra="forbid")`.
5. **Parameterize all SQL** — never interpolate user data into query strings; use SQLAlchemy ORM or parameterized queries.
6. **CORS locked down** — allow only the frontend origin; never use `allow_origins=["*"]` in production.
7. **JWT secrets rotatable** — store `JWT_SECRET` in env; support rotation without downtime.
