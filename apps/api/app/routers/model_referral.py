"""Model Referral Router - handles model-to-model referral endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.security import require_creator, require_user
from app.services import model_referral_service
from app.theme.brand import APP_NAME, APP_SCHEME


router = APIRouter(prefix="/model-referral", tags=["model-referral"])


class ApplyModelReferralRequest(BaseModel):
    code: str


@router.get("/overview")
async def model_referral_overview(user: dict = Depends(require_creator)):
    """Get model referral overview for the authenticated creator."""
    return await model_referral_service.get_model_referral_overview(user)


@router.post("/apply")
async def apply_model_referral(body: ApplyModelReferralRequest, user: dict = Depends(require_user)):
    """Apply a model referral code (only for creators)."""
    if user.get("user_type") != "creator":
        raise HTTPException(403, "Only creators can use model referral codes")
    return await model_referral_service.apply_model_referral_code(user, body.code)


@router.get("/earnings")
async def model_referral_earnings(user: dict = Depends(require_creator)):
    """Get detailed earnings from model referrals."""
    return await model_referral_service.get_model_referral_earnings(user)


@router.get("/referrals")
async def model_referrals_list(user: dict = Depends(require_creator)):
    """Get list of referred models with details."""
    return await model_referral_service.get_model_referrals_list(user)


@router.get("/share-message")
async def get_share_message(user: dict = Depends(require_creator)):
    """Get the share message for model referral."""
    overview = await model_referral_service.get_model_referral_overview(user)
    code = user.get("model_referral_code") or ""
    scheme = APP_SCHEME or "simpletalk"
    share_url = f"{scheme}://login?model_ref={code}"
    return {"success": True, "message": model_referral_service._build_share_message(code, share_url)}