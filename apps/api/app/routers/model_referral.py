"""Model Referral Router - handles model-to-model referral endpoints."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.security import require_creator, require_user
from app.services import model_referral_service

router = APIRouter(prefix="/model-referral", tags=["model-referral"])


class ApplyModelReferralRequest(BaseModel):
    code: str


@router.get("/overview")
async def model_referral_overview(user: dict = Depends(require_creator)):
    """Get model referral overview for the authenticated creator."""
    return await model_referral_service.get_model_referral_overview(user)


@router.post("/apply")
async def apply_model_referral(body: ApplyModelReferralRequest, user: dict = Depends(require_user)):
    """Apply a model referral code (only creators can apply one)."""
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
    """Get the share message for the creator's model referral code."""
    settings = get_settings()
    code = await model_referral_service.ensure_model_referral_code(user)
    share_url = f"{settings.deep_link_scheme or 'simpletalk'}://login?model_ref={code}"
    return {
        "success": True,
        "message": model_referral_service.build_share_message(code, share_url),
    }
