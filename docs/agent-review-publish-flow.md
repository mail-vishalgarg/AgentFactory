# Agent Review & Publish Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PUBLISH — a real LangGraph interrupt                 │
└─────────────────────────────────────────────────────────────────────────┘

  Owner clicks "Publish to Marketplace"
       │
       ▼
  POST /agents/{id}/publish
       │
       ├─► evaluate_publish_gate(config, run_count, ok_count)
       │        │
       │        ├── FAILS ──► 400 { blocked_reason }   (agent stays Draft)
       │        │
       │        └── PASSES
       │             │
       │             ▼
       │        thread_id = uuid4()
       │        graph.ainvoke({agent_id, name, score, governance_grade, ...},
       │                       config={"thread_id": thread_id})
       │             │
       │             └─► _await_admin_decision node calls interrupt()
       │                      │
       │                      └─► genuinely PAUSES here — state checkpointed
       │                          to Postgres (session-mode pooler, :5432 —
       │                          required; AsyncPostgresSaver's pipelined
       │                          writes break on Supabase's transaction-mode
       │                          pooler at :6543)
       │
       └─► publish_review_repo.create_review(...)
                └─► publish_reviews row { thread_id, status: "pending", ... }


┌─────────────────────────────────────────────────────────────────────────┐
│                ADMIN REVIEW — resuming the paused graph                 │
└─────────────────────────────────────────────────────────────────────────┘

  Admin opens /admin
       │
       ▼
  GET /marketplace/admin/pending
       └─► publish_review_repo.list_pending_reviews()  (no owner_id filter —
            the one deliberate cross-tenant read, gated by require_admin)

  Admin clicks Approve / Request changes / Reject
       │
       ▼
  POST /marketplace/admin/{id}/decide { decision, notes }
       │
       ├─► graph.ainvoke(Command(resume={decision, notes}),
       │                  config={"thread_id": review.thread_id})
       │        └─► resumes from EXACTLY where interrupt() paused —
       │            even across a backend restart in between (verified live)
       │
       ├─► publish_review_repo.mark_decided(id, decision, notes)
       │        └─► publish_reviews.status = decision, decided_at = now()
       │
       └─► if decision == "approved":
                marketplace_repo.create_listing(...)
                     └─► marketplace_listings row, status="approved"
                         tools SANITIZED: no credentials, no mcp_server_id,
                         publisher identity reduced to an email-domain label
                         (Rule 5 — publishing strips the company out)
```

## Data model

**`publish_reviews`** — one row per Publish attempt, 1:1 with a LangGraph thread

| column | note |
|---|---|
| `thread_id` | unique, text — the LangGraph checkpoint key |
| `agent_id`, `owner_id` | FKs |
| `tools` | jsonb, sanitized snapshot taken at submit time |
| `score`, `governance_grade` | frozen at submit time |
| `status` | `pending` \| `approved` \| `rejected` \| `changes_requested` |
| `review_notes`, `decided_at` | set on decide |

**`marketplace_listings`** — only ever holds rows that have already been approved

| column | note |
|---|---|
| `publisher_owner_id` | whose workspace gets install-count credit, not "which company" |
| `tools` | no credentials, no internal `mcp_server_id` |
| `install_count` | incremented on each install |
| `status` | only ever created as `"approved"` |

## Logic

- **Real interrupt, not a DB-row simulation** — the graph's one node calls `interrupt()`, which genuinely suspends the coroutine; nothing about "pending" is faked with a plain status column alone.
- **Session-mode pooler is load-bearing** — `AsyncPostgresSaver`'s pipelined checkpoint writes hit `DuplicatePreparedStatement` against Supabase's transaction-mode pgbouncer (port 6543), even with `prepare_threshold=0`. Connecting the checkpointer via the session-mode pooler (port 5432, same credentials) fixed it.
- **`thread_id` is the join key** between the queryable `publish_reviews` row and the actual paused LangGraph state — resuming is always `Command(resume=...)` addressed by that same id.
- **Rule 5 enforced at creation, not at read time** — the sanitized tool list is built once, in `publish_agent`, before the graph ever runs; there's no raw/full version sitting in `publish_reviews` waiting to leak later.
- **The one deliberate isolation exception** — admin routes read across every owner's `publish_reviews` and `marketplace_listings` with no `owner_id` filter, entirely guarded by `require_admin`. This is called out explicitly in the migration comment for both tables.
- **Connection pool hardening** — the checkpointer's `AsyncConnectionPool` uses `max_idle=180` and `check=AsyncConnectionPool.check_connection`, since Supabase's session-mode pooler silently closes idle connections and a stale one being handed out crashes the request with `server closed the connection unexpectedly`.

> **Key insight:** the pause is real, not simulated — verified by killing the backend process
> mid-pause and resuming successfully after a fresh restart. `thread_id` is what makes that
> possible: it's a stable pointer into Postgres-backed state that outlives the Python process.
