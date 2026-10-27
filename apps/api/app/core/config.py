from functools import lru_cache
from typing import List, Union

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    backend_url: str = "http://localhost:8000"
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "voxora"
    redis_url: str = "redis://localhost:6379/0"
    # Upstash REST pair — if set, redis client builds rediss:// automatically
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""

    jwt_secret: str = "dev-secret-change-me"
    jwt_expire_days: int = 45
    admin_jwt_secret: str = "dev-admin-secret-change-me"

    cors_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:8081"
    socketio_cors_origins: str = "*"

    environment: str = "development"
    allow_admin_bootstrap: bool = True
    app_name: str = "Simple Talk"

    messagecentral_customer_id: str = ""
    messagecentral_api_key: str = ""
    messagecentral_email: str = ""

    agora_app_id: str = ""
    agora_app_certificate: str = ""

    firebase_credentials_path: str = ""
    # Alternative to firebase_credentials_path: the whole service-account JSON as a
    # string env var. Use one or the other. The JSON wins only if the path is unset.
    firebase_credentials_json: str = ""

    # PayQ UPI collections (live payments only; no documented sandbox)
    payq_base_url: str = "https://payq.cc/api"
    payq_user_token: str = ""
    # Separate secret shown on the PayQ API Setup page. Used only for the
    # webhook hash; it is not the merchant API token.
    payq_webhook_secret: str = ""
    # Optional override. Falls back to backend_url + /api/wallet/recharge/return
    payq_return_url: str = ""

    # Recharge economics: platform keeps 6% total, user is credited 94%.
    # PayQ's advertised gateway commission is 0%, so the default split is
    # 0% gateway + 6% platform service. The total is what matters to users.
    min_recharge_amount: float = 50.0
    max_recharge_amount: float = 100000.0
    recharge_commission_rate: float = 0.06
    recharge_gateway_rate: float = 0.0

    imagekit_private_key: str = ""
    imagekit_public_key: str = ""
    imagekit_url_endpoint: str = ""

    commission_rate: float = 0.15
    referral_bonus_referrer: float = 25.0
    referral_bonus_referee: float = 20.0
    # Withdrawal economics: the creator pays 10% on the requested amount.
    # If the creator was referred, 5% of the gross withdrawal is paid to the
    # referrer and the platform keeps the other 5%. Otherwise the platform
    # keeps the full 10%.
    withdrawal_commission_rate: float = 0.10
    # Model Referral Settings
    model_referral_bonus_percentage: float = 5.0
    model_referral_min_withdrawal: float = 100.0
    model_referral_code_prefix: str = "MDL"
    model_referral_code_length: int = 6
    call_ring_timeout_seconds: int = 45
    min_audio_rate: float = 3.0
    min_video_rate: float = 7.0
    app_min_version_android: str = "1.0.0"
    app_min_version_ios: str = "1.0.0"
    deep_link_scheme: str = "simpletalk"

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def socketio_cors_list(self) -> Union[str, List[str]]:
        """Origins socket.io accepts.

        Returns the *string* "*" for a wildcard, not ["*"]. engine.io only
        treats the bare string as "allow everything"; a one-element list is
        matched by exact membership, so ["*"] rejects every real Origin and the
        WebSocket upgrade fails with 403 -- which silently broke presence, live
        call signalling and status updates.
        """
        raw = self.socketio_cors_origins.strip()
        if raw == "*" or not raw:
            return "*"
        return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
