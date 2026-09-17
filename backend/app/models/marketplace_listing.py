import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class MarketplaceListing(Base):
    __tablename__ = "marketplace_listings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    publisher_owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    tools: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    governance_grade: Mapped[str] = mapped_column(String, nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_id: Mapped[str] = mapped_column(String, nullable=False, default="gpt-4o-mini")
    temperature: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=0)
    publisher_org: Mapped[str] = mapped_column(String, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    install_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
