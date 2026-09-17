import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import agent as agent_repo
from app.repositories import marketplace as marketplace_repo
from app.repositories import mcp as mcp_repo
from app.schemas.agent import AgentConfigSchema, AgentResponse, GraphConfig, ModelConfig, ToolConfig
from app.schemas.marketplace import MarketplaceListingResponse, MarketplaceToolInfo

router = APIRouter()


def _to_response(listing: object) -> MarketplaceListingResponse:
    return MarketplaceListingResponse(
        id=str(listing.id),  # type: ignore[attr-defined]
        name=listing.name,  # type: ignore[attr-defined]
        description=listing.description,  # type: ignore[attr-defined]
        tools=[MarketplaceToolInfo.model_validate(t) for t in listing.tools],  # type: ignore[attr-defined]
        score=listing.score,  # type: ignore[attr-defined]
        governance_grade=listing.governance_grade,  # type: ignore[attr-defined]
        publisher_org=listing.publisher_org,  # type: ignore[attr-defined]
        install_count=listing.install_count,  # type: ignore[attr-defined]
        submitted_at=listing.submitted_at,  # type: ignore[attr-defined]
    )


@router.get("", response_model=list[MarketplaceListingResponse])
async def list_marketplace(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MarketplaceListingResponse]:
    listings = await marketplace_repo.list_approved_listings(db)
    return [_to_response(listing) for listing in listings]


@router.get("/{listing_id}", response_model=MarketplaceListingResponse)
async def get_marketplace_listing(
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MarketplaceListingResponse:
    listing = await marketplace_repo.get_approved_listing(db, listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return _to_response(listing)


@router.post("/{listing_id}/install", response_model=AgentResponse)
async def install_listing(
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AgentResponse:
    listing = await marketplace_repo.get_approved_listing(db, listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    tool_configs: list[ToolConfig] = []
    for t in listing.tools:
        tool = await mcp_repo.get_visible_tool_by_name(db, t["mcp_server_name"], t["tool_name"], user.id)
        if tool is None:
            continue
        tool_configs.append(
            ToolConfig(
                mcp_server_id=str(tool.mcp_server_id),
                mcp_server_name=t["mcp_server_name"],
                tool_name=t["tool_name"],
                tool_description=t["tool_description"],
                input_schema=tool.input_schema,
                permission_level=t["permission_level"],
                requires_approval=t.get("requires_approval", False),
            )
        )

    config = AgentConfigSchema(
        agent_id=str(uuid.uuid4()),
        name=listing.name,
        description=listing.description,
        created_at=datetime.now(timezone.utc).isoformat(),
        model=ModelConfig(
            provider="openai", model_id=listing.model_id, temperature=float(listing.temperature)
        ),
        system_prompt=listing.system_prompt,
        tools=tool_configs,
        graph=GraphConfig(type="react_agent", checkpointer=False),
        metadata={"installed_from_listing": str(listing.id), "builder_version": "1.0"},
    )
    agent = await agent_repo.save_agent(
        db,
        owner_id=user.id,
        name=listing.name,
        description=listing.description,
        config_dict=config.model_dump(mode="json"),
        credentials={},
    )
    await marketplace_repo.increment_install_count(db, listing_id)

    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        status=agent.status,
        config=config,
        created_at=agent.created_at,
        api_token=agent.api_token,
        run_count=0,
        last_run_status=None,
        last_run_at=None,
    )
