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
    verification_id: Optional[str] = None
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
        if len(code) != 4:
            raise ValueError("OTP must be 4 digits")
        return code


LANGUAGES = [
    "Hindi",
    "English",
    "Tamil",
    "Telugu",
    "Kannada",
    "Malayalam",
    "Bengali",
    "Marathi",
]
CATEGORIES = [
    "Fashion & Style",
    "Fitness & Health",
    "Beauty & Makeup",
    "Travel & Lifestyle",
    "Food & Cooking",
    "Tech & Gaming",
    "Entertainment",
    "Music & Dance",
    "Comedy & Memes",
    "Art & Photography",
    "Business & Finance",
    "Education",
    "Relationship & Dating",
]
GENDERS = ["Female", "Male", "Other"]


class CompleteProfileRequest(BaseModel):
    name: str
    username: Optional[str] = None
    picture: Optional[str] = None
    user_type: UserType = UserType.USER
    referral_code: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    category: Optional[str] = None
    languages: Optional[List[str]] = None
    famous_profile_link: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        name = (v or "").strip()
        if len(name) < 2:
            raise ValueError("Name must be at least 2 characters")
        return name

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        username = str(v).strip().lower()
        if len(username) < 3:
            raise ValueError("Username must be at least 3 characters")
        if not re.fullmatch(r"[a-z0-9_-]+", username):
            raise ValueError("Only letters, numbers, _ and - allowed")
        return username

    @field_validator("famous_profile_link")
    @classmethod
    def validate_social(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        link = str(v).strip()
        if not re.match(r"^https?://", link, re.I) or not re.search(
            r"(instagram\.com|youtu\.be|youtube\.com)", link, re.I
        ):
            raise ValueError("Enter a valid Instagram or YouTube link")
        return link


class ImageUploadRequest(BaseModel):
    image_base64: str


class ImageDeleteRequest(BaseModel):
    image_url: str


class VerificationSubmitRequest(BaseModel):
    verification_id: str
    image_base64: str


class ApplyReferralRequest(BaseModel):
    code: str


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


class AccountDeletionRequest(BaseModel):
    phone_number: str
    name: str
    audio_rate_per_minute: Optional[float] = None
    video_rate_per_minute: Optional[float] = None
    social_profile_link: Optional[str] = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v or "")
        if len(digits) != 10:
            raise ValueError("Phone must be a 10-digit mobile number")
        return digits


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
