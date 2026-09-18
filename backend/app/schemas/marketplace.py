from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class MarketplaceToolInfo(BaseModel):
    mcp_server_name: str
    tool_name: str
    tool_description: str
    permission_level: str
    requires_approval: bool = False


class MarketplaceListingResponse(BaseModel):
    id: str
    name: str
    description: str
    tools: list[MarketplaceToolInfo]
    score: int
    governance_grade: str
    publisher_org: str
    install_count: int
    submitted_at: datetime


class PendingListingResponse(BaseModel):
    id: str
    agent_id: str
    name: str
    description: str
    tools: list[MarketplaceToolInfo]
    score: int
    governance_grade: str
    publisher_org: str
    status: str
    submitted_at: datetime


class DecideListingRequest(BaseModel):
    decision: Literal["approved", "rejected"]
    notes: str | None = None


class DecideListingResponse(BaseModel):
    id: str
    status: str
    review_notes: str | None
    reviewed_at: datetime | None
