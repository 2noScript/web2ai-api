import os
import logging
from fastapi import Body, Request
from fastapi.responses import JSONResponse
from core.schemas import ChatCompletionRequest, ChatCompletionResponse
from core.session.adapters import get_adapter
from core.session.history import sync_and_get_history
from core.services.chat_service import chat_service
from core.services.metaai_strategy import MetaAIStrategy
from .models import METAAI_MODEL_IDS
from .router import router

logger = logging.getLogger(__name__)
metaai_strategy = MetaAIStrategy()


@router.post(
    "/chat/completions",
    summary="Create a chat completion using Meta AI models",
    response_model=ChatCompletionResponse,
    response_model_exclude_none=True,
)
async def chat_completions(
    request: Request,
    body: ChatCompletionRequest = Body(
        openapi_examples={
            "basic": {
                "summary": "Basic chat",
                "value": {
                    "model": "meta-ai",
                    "messages": [{"role": "user", "content": "Hello Meta AI!"}],
                    "stream": False,
                },
            }
        }
    ),
):
    messages = body.messages
    stream = body.stream
    model = body.model or "meta-ai"

    if model.lower() not in METAAI_MODEL_IDS:
        return JSONResponse(
            {
                "error": {
                    "message": f"Model '{model}' not supported. Supported: {list(METAAI_MODEL_IDS)}",
                    "type": "invalid_request_error",
                    "code": "model_not_found",
                }
            },
            status_code=400,
        )

    # Session integration
    adapter = get_adapter("metaai")
    session_data = getattr(request.state, "session_data", {})

    # Sync local history with incoming messages
    body_messages = [m.model_dump() for m in messages]
    sync_and_get_history(body_messages, session_data)

    if stream:
        return await chat_service.execute_stream(
            strategy=metaai_strategy,
            request=request,
            messages=body_messages,
            model=model,
            session_data=session_data,
            adapter=adapter,
        )

    return await chat_service.execute_chat(
        strategy=metaai_strategy,
        request=request,
        messages=body_messages,
        model=model,
        session_data=session_data,
        adapter=adapter,
    )
