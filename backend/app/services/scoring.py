from dataclasses import dataclass

from app.schemas.agent import AgentConfigSchema

SCORE_THRESHOLD = 70
GOVERNANCE_THRESHOLD = "B"
_GRADE_RANK = {"A": 4, "B": 3, "C": 2, "D": 1, "F": 0}


@dataclass
class ScoreBreakdown:
    reliability: int  # 0-40: run success rate
    scope: int  # 0-30: fewer tools scores higher
    coverage: int  # 0-15: has it actually been tested
    completeness: int  # 0-15: description/prompt filled in

    @property
    def total(self) -> int:
        return self.reliability + self.scope + self.coverage + self.completeness


def compute_score(config: AgentConfigSchema, run_count: int, ok_count: int) -> ScoreBreakdown:
    reliability = round((ok_count / run_count) * 40) if run_count > 0 else 0

    tool_count = len(config.tools)
    scope = max(0, 30 - max(0, tool_count - 1) * 2) if tool_count > 0 else 0

    coverage = min(15, run_count * 3)

    completeness = 0
    if len(config.description.strip()) >= 20:
        completeness += 5
    if len(config.system_prompt.strip()) >= 20:
        completeness += 5
    if tool_count > 0:
        completeness += 5

    return ScoreBreakdown(reliability=reliability, scope=scope, coverage=coverage, completeness=completeness)


def compute_governance(config: AgentConfigSchema) -> str:
    """Grade derived from how much of the agent's toolset is read-only vs.
    write/destructive, penalized further for a destructive tool in a
    broad-scope agent (bigger blast radius if that tool misbehaves)."""
    tools = config.tools
    if not tools:
        return "A"

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
    if has_destructive and len(tools) > 10 and _GRADE_RANK[grade] > _GRADE_RANK["C"]:
        grade = "C"

    return grade


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


def evaluate_publish_gate(config: AgentConfigSchema, run_count: int, ok_count: int) -> PublishGate:
    score = compute_score(config, run_count, ok_count).total
    governance = compute_governance(config)
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
    )
