import logging
import re
from typing import Any, TypedDict

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import settings

logger = logging.getLogger(__name__)


class PublishReviewState(TypedDict):
    agent_id: str
    name: str
    score: int
    governance_grade: str
    decision: str | None
    notes: str | None


def _await_admin_decision(state: PublishReviewState) -> dict[str, Any]:
    """The one node in this graph. Calling interrupt() persists the current
    state to the checkpointer and pauses here — durably, since the
    checkpointer is Postgres-backed, not in-memory. Resuming later
    (Command(resume=...)) replays from this exact point; `payload` is
    whatever was passed to `resume`."""
    payload = interrupt(
        {
            "agent_id": state["agent_id"],
            "name": state["name"],
            "score": state["score"],
            "governance_grade": state["governance_grade"],
        }
    )
    return {"decision": payload["decision"], "notes": payload.get("notes")}


def _build_graph(checkpointer: AsyncPostgresSaver):
    builder = StateGraph(PublishReviewState)
    builder.add_node("await_admin_decision", _await_admin_decision)
    builder.set_entry_point("await_admin_decision")
    builder.add_edge("await_admin_decision", END)
    return builder.compile(checkpointer=checkpointer)


_pool: AsyncConnectionPool | None = None
_graph: Any = None


async def init_publish_graph() -> None:
    """Called once from the app's lifespan startup. Idempotent."""
    global _pool, _graph
    if _graph is not None:
        return

    # Same asyncpg->psycopg DSN rewrite as db.py does for the SQLAlchemy
    # engine. AsyncPostgresSaver additionally can't run against Supabase's
    # transaction-mode pooler (port 6543) at all — its pipelined writes hit
    # "prepared statement already exists" even with prepare_threshold=0,
    # since pgbouncer transaction mode can hand the same physical connection
    # to two different pipelined statements. Session-mode pooling on 5432
    # (same host/credentials) keeps one real connection per session, which
    # this driver requires. Verified against the real Supabase instance.
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    dsn = re.sub(r":6543/", ":5432/", dsn)
    _pool = AsyncConnectionPool(
        conninfo=dsn,
        max_size=5,
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )
    await _pool.open()
    checkpointer = AsyncPostgresSaver(_pool)
    await checkpointer.setup()
    _graph = _build_graph(checkpointer)
    logger.info("Publish review graph ready (persistent Postgres checkpointer).")


def get_publish_graph():
    if _graph is None:
        raise RuntimeError("Publish graph not initialized — call init_publish_graph() at startup.")
    return _graph


async def close_publish_graph() -> None:
    global _pool, _graph
    if _pool is not None:
        await _pool.close()
    _pool = None
    _graph = None
