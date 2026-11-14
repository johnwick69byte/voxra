"""Fan-to-creator text chat."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.security import require_user
from app.services import chat_service

router = APIRouter(prefix="/chat", tags=["chat"])


class OpenChatRequest(BaseModel):
    creator_id: str = Field(min_length=1, max_length=80)


class SendChatMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    client_message_id: str = Field(min_length=1, max_length=80)


@router.get("/conversations")
async def conversations(user: dict = Depends(require_user)):
    return await chat_service.list_conversations(user)


@router.post("/conversations")
async def open_conversation(body: OpenChatRequest, user: dict = Depends(require_user)):
    return await chat_service.open_conversation(user, body.creator_id)


@router.get("/conversations/{conversation_id}/messages")
async def messages(
    conversation_id: str,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[str] = None,
    user: dict = Depends(require_user),
):
    return await chat_service.list_messages(
        user, conversation_id, limit=limit, before=before
    )


@router.post("/conversations/{conversation_id}/read")
async def mark_read(conversation_id: str, user: dict = Depends(require_user)):
    return await chat_service.mark_read(user, conversation_id)


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendChatMessageRequest,
    user: dict = Depends(require_user),
):
    return await chat_service.send_message(
        user, conversation_id, body.text, body.client_message_id
    )
