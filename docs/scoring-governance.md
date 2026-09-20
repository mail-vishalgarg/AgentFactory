# Scoring & Governance

```
┌─────────────────────────────────────────────────────────────────────────┐
│         THREE INDEPENDENT SIGNALS, AND-ed AT THE PUBLISH GATE           │
└─────────────────────────────────────────────────────────────────────────┘

   AgentConfigSchema                    agent_runs
   { tools[], description,              { run_count, ok_count }
     system_prompt }                          │
         │                                    │
         ├──────────────┬─────────────────────┤
         ▼              ▼                     ▼
   compute_score()  compute_governance_    (feeds reliability
   ScoreBreakdown   breakdown()             + coverage below)
   (0-100)          Governance (A-F)
         │              │
         │        check_write_tools_gated()
         │        every write/destructive tool
         │        has requires_approval = True
         │              │              │
         ▼              ▼              ▼
   ┌─────────────────────────────────────────┐
   │     evaluate_publish_gate()  —  AND      │
   │  score ≥ 70   AND   governance ≥ B   AND │
   │            write_tools_gated             │
   └─────────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
        can_publish=True   can_publish=False
        Publish enabled    blocked_reason names
                            the FIRST failing check
```

## Data model — none. Computed live, every request.

| source | feeds |
|---|---|
| `agents.config` (jsonb) → `tools[].permission_level`/`requires_approval`, `description`, `system_prompt` | score + governance |
| `agent_runs` → `count(*)`, `count(status='ok')` | reliability + coverage |
| `agents.credentials` + `mcp_servers.status` | trust checklist only (not scored) |

## Logic — `compute_score()`

| component | range | formula |
|---|---|---|
| **reliability** | 0–40 | `round(ok/run × 40 × confidence)`, `confidence = min(1, run/5)` — a single lucky run can't max this out |
| **scope** | −30…30 | first tool free; each extra tool costs `1` (read) / `2` (write) / `3` (destructive), subtracted from 30, floored at −30 |
| **coverage** | 0–15 | `round(min(15, run×3) × ok/run)` — attempts only count if they succeed |
| **completeness** | 0–15 | +5 description ≥20 chars, +5 system_prompt ≥20 chars, +5 has ≥1 tool |
| **total** | 0–100 | `clamp(reliability + scope + coverage + completeness, 0, 100)` |

## Logic — `compute_governance_breakdown()`

- `read_only_ratio = count(permission_level == "read") / total_tools`
- `≥0.8 → A`, `≥0.6 → B`, `≥0.4 → C`, `≥0.2 → D`, else `F`
- **Capped at C** if any `destructive` tool exists **and** the agent has more than 10 tools total — bigger blast radius if that one tool misbehaves.

## Logic — the publish gate

`evaluate_publish_gate()` requires **all three**, independently:

1. `score ≥ 70` (`SCORE_THRESHOLD`)
2. `governance ≥ B` (`GOVERNANCE_THRESHOLD`)
3. `check_write_tools_gated()` — every write/destructive tool's `requires_approval == True`

If any fails, `blocked_reason` names the *first* one that does — never a vague "can't publish."

## Trust checklist (surfaced, not scored)

Four checks built in `build_trust_checklist()`, shown in the Settings tab under the score:

- Write/destructive tools require approval (reuses check #3 above)
- All attached MCP servers report `status == "healthy"`
- No stored credential value appears as a substring inside the system prompt or any tool description (a live scan, not an assumption)
- Tested N times in the playground (`run_count`)

## Worked example — `github_agent`, live data (2026-09-19)

```
inputs        26 tools (all read) · 2/2 runs ok · description 17 chars
reliability   round(2/2 × 40 × min(1, 2/5)) = round(40 × 0.4)        = 16
scope         30 − (25 extra tools × 1/read)                        =  5
coverage      round(min(15, 6) × 1.0)                                =  6
completeness  desc<20 (+0) + prompt≥20 (+5) + has tools (+5)         = 10
─────────────────────────────────────────────────────────────────────────
total         16 + 5 + 6 + 10                                       = 37 / 100
```

Needs 5+ successful runs (reliability → 40, coverage → 15) and a description ≥20 chars
(completeness → 15) to clear the 70 threshold — the scope fix alone was never enough.

> **Key insight:** score and governance are deliberately never combined into one number.
> A perfect score with ungated write tools still can't publish, and a perfect governance
> grade with a broken agent still can't either — Rule 6's "a score that blocks nothing is
> decoration" is enforced structurally, not by convention.
