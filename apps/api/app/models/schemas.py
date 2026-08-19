from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class UserType(str, Enum):
    USER = "user"
    CREATOR = "creator"
    ADMIN = "admin"


class CallStatus(str, Enum):
    RINGING = "RINGING"
    ACCEPTED = "ACCEPTED"
    LIVE = "LIVE"
    ENDED = "ENDED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    MISSED = "MISSED"
    ENDED_INSUFFICIENT_BALANCE = "ENDED_INSUFFICIENT_BALANCE"
    ENDED_DISCONNECT = "ENDED_DISCONNECT"


class CreatorStatus(str, Enum):
    ACTIVE = "ACTIVE"
    BUSY = "BUSY"
    DND = "DND"
    OFFLINE = "OFFLINE"


class SendOtpRequest(BaseModel):
    phone: str
    country_code: str = "+91"


class VerifyOtpRequest(BaseModel):
    phone: str
    country_code: str = "+91"
    otp: str
    user_type: Optional[UserType] = None


class CompleteProfileRequest(BaseModel):
    name: str
    username: Optional[str] = None
    picture: Optional[str] = None
    user_type: UserType = UserType.USER
    referral_code: Optional[str] = None
    bio: Optional[str] = None


class PricingSetupRequest(BaseModel):
    audio_rate_per_minute: float
    video_rate_per_minute: float
    instant_call_enabled: bool = True


class InitiateCallRequest(BaseModel):
    receiver_id: str
    call_type: str = "AUDIO"  # AUDIO | VIDEO


class BillMinuteRequest(BaseModel):
    current_minute: int = 0


class RechargeInitiateRequest(BaseModel):
    amount: float
    package_id: Optional[str] = None


class ReviewRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class GiftRequest(BaseModel):
    amount: float


class SupportMessageRequest(BaseModel):
    subject: str
    message: str


class BroadcastNotificationRequest(BaseModel):
    title: str
    body: str
    audience: str = "all"  # all | users | creators


class AdminLoginRequest(BaseModel):
    email: str
    password: str


class PushTokenRequest(BaseModel):
    device_push_token: str
    platform: str = "android"


class WithdrawalRequest(BaseModel):
    amount: float
    upi_id: str
    account_name: Optional[str] = None


# Response helpers
class ApiOk(BaseModel):
    success: bool = True
    data: Optional[Any] = None
    message: Optional[str] = None
