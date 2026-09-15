from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models.user import User
from app.repositories import user as user_repo
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, UserResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter()


@router.post("/signup", response_model=TokenResponse, status_code=201)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await user_repo.get_user_by_email(db, body.email)
    if existing is not None:
        raise HTTPException(status_code=400, detail="An account with that email already exists.")

    user = await user_repo.create_user(
        db, email=body.email, password_hash=hash_password(body.password)
    )
    token = create_access_token(str(user.id), user.is_admin)
    return TokenResponse(
        access_token=token,
        user=UserResponse(id=user.id, email=user.email, is_admin=user.is_admin),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await user_repo.get_user_by_email(db, body.email)
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(str(user.id), user.is_admin)
    return TokenResponse(
        access_token=token,
        user=UserResponse(id=user.id, email=user.email, is_admin=user.is_admin),
    )


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(id=user.id, email=user.email, is_admin=user.is_admin)
