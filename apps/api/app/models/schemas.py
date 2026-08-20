from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
import re

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v or "")
        if len(digits) != 10:
            raise ValueError("Phone must be a 10-digit mobile number")
        if digits[0] not in "6789":
            raise ValueError("Enter a valid Indian mobile number")
        return digits


class VerifyOtpRequest(BaseModel):
    phone: str
    country_code: str = "+91"
    otp: str
    user_type: Optional[UserType] = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v or "")
        if len(digits) != 10:
            raise ValueError("Phone must be a 10-digit mobile number")
        return digits

    @field_validator("otp")
    @classmethod
    def validate_otp(cls, v: str) -> str:
        code = re.sub(r"\D", "", v or "")
        if len(code) != 6:
            raise ValueError("OTP must be 6 digits")
        return code


class CompleteProfileRequest(BaseModel):
    name: str
    username: Optional[str] = None
    picture: Optional[str] = None
    user_type: UserType = UserType.USER
    referral_code: Optional[str] = None
    bio: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        name = (v or "").strip()
        if len(name) < 2:
            raise ValueError("Name must be at least 2 characters")
        return name


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    picture: Optional[str] = None
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
