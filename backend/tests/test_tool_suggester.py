from types import SimpleNamespace
from typing import Any

import pytest

from app.services import tool_suggester as ts


def _server(name: str) -> Any:
    return SimpleNamespace(name=name, description=f"{name} server", tools=[SimpleNamespace(name="t1")])


class _FakeLLM:
    def __init__(self, result: Any = None, error: Exception | None = None) -> None:
        self._result, self._error = result, error

    def with_structured_output(self, _schema: Any) -> "_FakeLLM":
        return self

    async def ainvoke(self, _messages: Any) -> Any:
        if self._error:
            raise self._error
        return self._result


SERVERS = [_server("github"), _server("slack")]


@pytest.mark.asyncio
async def test_returns_llm_text_and_matched_servers() -> None:
    raw = ts._LLMSuggestion(
        message="GitHub and Slack fit.", agent_name="Repo Notifier!", purpose="Post repos to Slack",
        server_names=["GitHub", "slack"],
    )
    result = await ts.suggest_with_llm(_FakeLLM(raw), "get repo and post in slack", SERVERS)  # type: ignore[arg-type]
    assert result is not None
    assert result.message == "GitHub and Slack fit."
    assert result.agent_name == "repo_notifier"
    assert result.matched_names == {"github", "slack"}


@pytest.mark.asyncio
async def test_invented_server_names_are_dropped() -> None:
    raw = ts._LLMSuggestion(message="m", agent_name="a", purpose="p", server_names=["github", "evil-server"])
    result = await ts.suggest_with_llm(_FakeLLM(raw), "x", SERVERS)  # type: ignore[arg-type]
    assert result is not None and result.matched_names == {"github"}


@pytest.mark.asyncio
async def test_llm_failure_returns_none() -> None:
    result = await ts.suggest_with_llm(_FakeLLM(error=RuntimeError("boom")), "x", SERVERS)  # type: ignore[arg-type]
    assert result is None


@pytest.mark.asyncio
async def test_no_servers_returns_none() -> None:
    assert await ts.suggest_with_llm(_FakeLLM(), "x", []) is None  # type: ignore[arg-type]
