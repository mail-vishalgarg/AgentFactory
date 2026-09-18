from dataclasses import dataclass

from app.schemas.agent import AgentConfigSchema

SCORE_THRESHOLD = 70
GOVERNANCE_THRESHOLD = "B"
_GRADE_RANK = {"A": 4, "B": 3, "C": 2, "D": 1, "F": 0}

# Below this many runs, reliability is scaled down — a single success out of
# one run shouldn't score the same as a proven track record.
MIN_RUNS_FOR_FULL_CONFIDENCE = 5


@dataclass
class ScoreBreakdown:
    reliability: int  # up to 40: run success rate, scaled down under MIN_RUNS_FOR_FULL_CONFIDENCE
    scope: int  # -30..30: fewer tools scores higher, more keeps subtracting past the old floor
    coverage: int  # 0-15: run_count credit, weighted by how many of those runs actually succeeded
    completeness: int  # 0-15: description/prompt filled in

    @property
    def total(self) -> int:
        return max(0, min(100, self.reliability + self.scope + self.coverage + self.completeness))


@dataclass
class GovernanceBreakdown:
    grade: str
    read_only_count: int
    total_tools: int
    read_only_ratio: float
    capped_for_destructive_scope: bool  # True if a destructive tool + >10 tools forced the grade down to C


@dataclass
class ChecklistItem:
    label: str
    ok: bool
    detail: str


def build_trust_checklist(
    config: AgentConfigSchema,
    credentials: dict[str, str],
    server_statuses: dict[str, str],
    run_count: int,
) -> list[ChecklistItem]:
    """Concrete, checkable facts backing the score — Rule 6: 'you must be
    able to point at exactly why a number is what it is.'"""
    write_tools_gated = check_write_tools_gated(config)

    unhealthy = [sid for sid in {t.mcp_server_id for t in config.tools} if server_statuses.get(sid) != "healthy"]

    haystack = (config.system_prompt or "") + " ".join(
        f"{t.tool_name} {t.tool_description}" for t in config.tools
    )
    leaked = [key for key, value in credentials.items() if value and value in haystack]

    return [
        ChecklistItem(
            label="Write and destructive tools require approval",
            ok=write_tools_gated,
            detail=(
                "Every write/destructive tool is gated behind human approval."
                if write_tools_gated
                else "Some write or destructive tools aren't gated behind approval."
            ),
        ),
        ChecklistItem(
            label="All tool servers healthy",
            ok=len(unhealthy) == 0,
            detail=(
                "Every attached MCP server reports healthy."
                if not unhealthy
                else f"{len(unhealthy)} attached server(s) are degraded or unreachable."
            ),
        ),
        ChecklistItem(
            label="No credentials found in configuration",
            ok=len(leaked) == 0,
            detail=(
                "No stored credential value appears in the prompt or tool descriptions."
                if not leaked
                else f"{len(leaked)} credential value(s) were found inside the agent's own configuration."
            ),
        ),
        ChecklistItem(
            label=f"Tested {run_count} time{'s' if run_count != 1 else ''} in the playground",
            ok=run_count > 0,
            detail=(
                "Run it at least once before publishing."
                if run_count == 0
                else "Reliability and coverage above are derived from these runs."
            ),
        ),
    ]


_SCOPE_TOOL_COST = {"read": 1, "write": 2, "destructive": 3}


def compute_score(config: AgentConfigSchema, run_count: int, ok_count: int) -> ScoreBreakdown:
    if run_count > 0:
        confidence = min(1.0, run_count / MIN_RUNS_FOR_FULL_CONFIDENCE)
        reliability = round((ok_count / run_count) * 40 * confidence)
    else:
        reliability = 0

    tool_count = len(config.tools)
    if tool_count > 0:
        # First tool is free; each one after costs more if it can write or
        # destroy, less if it's read-only — breadth is riskier when the
        # tools involved can actually change something.
        extra_tools = config.tools[1:]
        penalty = sum(_SCOPE_TOOL_COST.get(t.permission_level, 2) for t in extra_tools)
        scope = max(-30, 30 - penalty)
    else:
        scope = 0

    if run_count > 0:
        coverage = round(min(15, run_count * 3) * (ok_count / run_count))
    else:
        coverage = 0

    completeness = 0
    if len(config.description.strip()) >= 20:
        completeness += 5
    if len(config.system_prompt.strip()) >= 20:
        completeness += 5
    if tool_count > 0:
        completeness += 5

    return ScoreBreakdown(reliability=reliability, scope=scope, coverage=coverage, completeness=completeness)


def compute_governance_breakdown(config: AgentConfigSchema) -> GovernanceBreakdown:
    """Grade derived from how much of the agent's toolset is read-only vs.
    write/destructive, penalized further for a destructive tool in a
    broad-scope agent (bigger blast radius if that tool misbehaves)."""
    tools = config.tools
    if not tools:
        return GovernanceBreakdown(
            grade="A", read_only_count=0, total_tools=0, read_only_ratio=1.0, capped_for_destructive_scope=False
        )

    read_only = sum(1 for t in tools if t.permission_level == "read")
    ratio = read_only / len(tools)

    if ratio >= 0.8:
        grade = "A"
    elif ratio >= 0.6:
        grade = "B"
    elif ratio >= 0.4:
        grade = "C"
    elif ratio >= 0.2:
        grade = "D"
    else:
        grade = "F"

    has_destructive = any(t.permission_level == "destructive" for t in tools)
    capped = has_destructive and len(tools) > 10 and _GRADE_RANK[grade] > _GRADE_RANK["C"]
    if capped:
        grade = "C"

    return GovernanceBreakdown(
        grade=grade,
        read_only_count=read_only,
        total_tools=len(tools),
        read_only_ratio=ratio,
        capped_for_destructive_scope=capped,
    )


def compute_governance(config: AgentConfigSchema) -> str:
    return compute_governance_breakdown(config).grade


def check_write_tools_gated(config: AgentConfigSchema) -> bool:
    """Every write/destructive tool must be marked to require human approval
    before it runs — Rule 4's platform-enforced gate, checked at publish time."""
    return all(
        t.requires_approval for t in config.tools if t.permission_level in ("write", "destructive")
    )


@dataclass
class PublishGate:
    score: int
    score_ok: bool
    governance: str
    governance_ok: bool
    write_tools_gated: bool
    can_publish: bool
    blocked_reason: str | None
    breakdown: ScoreBreakdown
    governance_detail: GovernanceBreakdown
    run_count: int
    ok_count: int


def evaluate_publish_gate(config: AgentConfigSchema, run_count: int, ok_count: int) -> PublishGate:
    breakdown = compute_score(config, run_count, ok_count)
    score = breakdown.total
    governance_detail = compute_governance_breakdown(config)
    governance = governance_detail.grade
    score_ok = score >= SCORE_THRESHOLD
    governance_ok = _GRADE_RANK[governance] >= _GRADE_RANK[GOVERNANCE_THRESHOLD]
    write_tools_gated = check_write_tools_gated(config)
    can_publish = score_ok and governance_ok and write_tools_gated

    blocked_reason = None
    if not can_publish:
        if not score_ok:
            blocked_reason = (
                f"Score is {score}, below the required {SCORE_THRESHOLD}. Run it more successfully "
                "and drop any tools it doesn't actually use to raise it."
            )
        elif not governance_ok:
            blocked_reason = "Too many write or destructive tools for its scope. Narrow it down."
        else:
            blocked_reason = "Some write or destructive tools aren't gated behind approval."

    return PublishGate(
        score=score,
        score_ok=score_ok,
        governance=governance,
        governance_ok=governance_ok,
        write_tools_gated=write_tools_gated,
        can_publish=can_publish,
        blocked_reason=blocked_reason,
        breakdown=breakdown,
        governance_detail=governance_detail,
        run_count=run_count,
        ok_count=ok_count,
    )
