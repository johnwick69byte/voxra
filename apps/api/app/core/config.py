from functools import lru_cache
from typing import List

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
    jwt_expire_days: int = 30
    admin_jwt_secret: str = "dev-admin-secret-change-me"

    cors_origins: str = "http://localhost:5173,http://localhost:8081"
    socketio_cors_origins: str = "*"

    environment: str = "development"
    allow_admin_bootstrap: bool = True

    dev_otp_code: str = "123456"
    messagecentral_customer_id: str = ""
    messagecentral_api_key: str = ""
    messagecentral_email: str = ""

    agora_app_id: str = ""
    agora_app_certificate: str = ""

    firebase_credentials_path: str = ""

    trustope_user_token: str = ""
    trustope_redirect_url: str = "http://localhost:8000/api/wallet/recharge/return"

    imagekit_private_key: str = ""
    imagekit_public_key: str = ""
    imagekit_url_endpoint: str = ""

    commission_rate: float = 0.15
    call_ring_timeout_seconds: int = 45
    min_audio_rate: float = 3.0
    min_video_rate: float = 7.0
    app_min_version_android: str = "1.0.0"
    app_min_version_ios: str = "1.0.0"
    deep_link_scheme: str = "voxora"

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def socketio_cors_list(self) -> List[str]:
        raw = self.socketio_cors_origins.strip()
        if raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
