# Login & Sessions

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SIGNUP / LOGIN — issuing a JWT                       │
└─────────────────────────────────────────────────────────────────────────┘

  Client
       │  POST /auth/signup { email, password }
       │  (password: ≥8 chars, 1 letter, 1 digit, 1 special char)
       ▼
  auth router
       │
       ├─► hash_password(password)  ──► bcrypt.hashpw(rounds=10)
       ├─► user_repo.create_user()  ──► users row (PostgreSQL)
       └─► create_access_token(user.id, user.is_admin)
                │   JWT payload: { sub: user.id, is_admin, exp: +N min }
                │   signed HS256
                └─► 200 { access_token, user }


  Client
       │  POST /auth/login { email, password }
       ▼
  auth router
       │
       ├─► user_repo.get_user_by_email(email)
       ├─► verify_password(password, user.password_hash)  ──► bcrypt.checkpw()
       │        │
       │        ├── wrong password ──┐
       │        └── unknown email  ──┴──► same "Invalid email or password"
       │                                   (no user-enumeration leak)
       └─► create_access_token(...)  ──► 200 { access_token, user }


┌─────────────────────────────────────────────────────────────────────────┐
│              EVERY AUTHENTICATED REQUEST — is_admin is never cached     │
└─────────────────────────────────────────────────────────────────────────┘

  Client
       │  GET /agents   Authorization: Bearer <jwt>
       ▼
  get_current_user (deps.py)
       │
       ├─► decode_access_token(token)
       │        algorithms=["HS256"]   ← explicit allowlist, not trusted from header
       │        └─► payload.sub
       │
       └─► user_repo.get_user_by_id(sub)  ──► SELECT * FROM users WHERE id = sub
                │
                └─► fresh User row, including is_admin
                     (is_admin is NEVER read from the token payload for
                      authorization — only the DB row counts)

  require_admin(user)
       │
       └─► 403 if not user.is_admin
```

## Data model — `users`

| column | type | note |
|---|---|---|
| `id` | uuid, pk | also the tenant key — every owned row (`agents`, `connections`, `mcp_servers`) has an `owner_id` pointing straight here. No separate `tenants` table. |
| `email` | text, unique | login identity |
| `password_hash` | text | bcrypt, cost = 10 |
| `is_admin` | bool | seeded `true` for `admin@capstone.com` |
| `created_at` / `updated_at` | timestamptz | |

## Logic — how it's actually enforced

- **Password rules** are checked in the `SignupRequest` Pydantic validator (≥8 chars, ≥1 letter, ≥1 digit, ≥1 special char) — rejected before it ever reaches `hash_password`.
- **No enumeration leak** — a wrong password and an unknown email both fall through to the exact same `"Invalid email or password"` response, from the same code path.
- **Token** is HS256 only; `decode_access_token` pins `algorithms=["HS256"]` explicitly rather than trusting whatever algorithm the token's own header claims.
- **Authorization never trusts the token for `is_admin`** — `get_current_user` uses the token only to get `sub` (the user id), then re-reads the live `User` row from Postgres. A demoted admin's still-unexpired token can't self-report as still-admin.
- **`require_admin`** is a one-line wrapper on top of `get_current_user` — 403 if the freshly-loaded user isn't an admin.

> **Key insight:** "one user per tenant" means `users.id` *is* the tenant boundary — there's no
> multi-user-per-company model, so every `owner_id` filter across the schema is really a
> "mine vs. not mine" check, not a "my company's vs. not" check.
