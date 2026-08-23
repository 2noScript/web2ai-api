import os
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, AsyncGenerator
from metaai_api import MetaAI
from core.services.base import BaseProviderStrategy

logger = logging.getLogger(__name__)


class MetaAIStrategy(BaseProviderStrategy):
    """Meta AI Provider Strategy implementation with dedicated single-thread execution."""

    def __init__(self):
        self._clients: dict[str, MetaAI] = {}
        self._executors: dict[str, ThreadPoolExecutor] = {}

    @property
    def provider_name(self) -> str:
        return "metaai"

    def _get_executor(self, prof_id: str) -> ThreadPoolExecutor:
        if prof_id not in self._executors:
            self._executors[prof_id] = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"metaai-{prof_id}")
        return self._executors[prof_id]

    async def get_or_create_client(self, profile: dict | None, request: Any) -> Any:
        cookie_str = ""
        prof_id = "default"
        if profile:
            cookie_str = profile.get("cookie") or profile.get("token", "")
            prof_id = profile.get("id", "default")

        if not cookie_str:
            raise ValueError("Meta AI profile has no valid cookie.")

        executor = self._get_executor(prof_id)

        if prof_id not in self._clients:
            logger.info("Initializing MetaAI client for profile: %s", prof_id)
            loop = asyncio.get_running_loop()
            ai = await loop.run_in_executor(executor, lambda: MetaAI(cookies=cookie_str))
            self._clients[prof_id] = ai

        return {"ai": self._clients[prof_id], "executor": executor, "prof_id": prof_id}

    async def execute_chat(
        self, client: Any, prompt: str, model: str, session_kwargs: dict, files: list[str] | None = None
    ) -> tuple[str, str]:
        ai: MetaAI = client["ai"]
        executor: ThreadPoolExecutor = client["executor"]
        conv_id = session_kwargs.get("conversation_id")
        
        # Check imagine mode
        is_imagine = (model.lower() == "meta-imagine" or prompt.strip().startswith("/imagine"))
        if is_imagine and not prompt.strip().startswith("/imagine"):
            prompt = f"/imagine {prompt.strip()}"

        loop = asyncio.get_running_loop()

        def do_prompt() -> dict[str, Any]:
            res = ai.prompt(
                message=prompt,
                conversation_id=conv_id,
                stream=False,
                images=files,
                timeout=60,
            )
            return res if isinstance(res, dict) else {}

        result = await loop.run_in_executor(executor, do_prompt)

        if not result or not isinstance(result, dict):
            raise RuntimeError("Empty or invalid response from Meta AI")

        # Save conversation_id to session kwargs for multi-turn persistence
        new_conv_id = result.get("conversation_id")
        if new_conv_id:
            session_kwargs["conversation_id"] = new_conv_id
            session_kwargs["_chat_instance"] = {"conversation_id": new_conv_id}

        msg = result.get("message", "")
        thought = result.get("raw", {}).get("thought", "")
        if not msg and thought:
            msg = thought
            thought = ""

        image_urls = result.get("image_urls", [])
        if image_urls:
            msg_urls = "\n".join([f"![Generated Image]({u})" for u in image_urls])
            msg = f"{msg}\n\n{msg_urls}".strip()

        return msg, thought

    async def execute_stream(
        self, client: Any, prompt: str, model: str, session_kwargs: dict, files: list[str] | None = None
    ) -> AsyncGenerator[str, None]:
        ai: MetaAI = client["ai"]
        executor: ThreadPoolExecutor = client["executor"]
        conv_id = session_kwargs.get("conversation_id")
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def run_stream() -> dict:
            try:
                for event_type, chunk in ai.prompt(
                    message=prompt,
                    conversation_id=conv_id,
                    images=files,
                    stream=True,
                    timeout=60,
                ):
                    if chunk:
                        loop.call_soon_threadsafe(queue.put_nowait, chunk)
                return {"ok": True}
            except Exception as e:
                return {"ok": False, "content": str(e)}

        t = loop.run_in_executor(executor, run_stream)

        while True:
            get_task = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait([get_task, t], return_when=asyncio.FIRST_COMPLETED)

            if get_task in done:
                chunk_text = get_task.result()
                yield chunk_text
            else:
                get_task.cancel()
                res = t.result()
                if not res.get("ok"):
                    raise RuntimeError(res.get("content", "Stream error"))
                while not queue.empty():
                    yield queue.get_nowait()
                break

    async def handle_profile_cleanup(self, profile_id: str | None) -> None:
        if profile_id and profile_id in self._clients:
            ai = self._clients.pop(profile_id, None)
            executor = self._executors.pop(profile_id, None)
            if ai:
                try:
                    if executor:
                        executor.submit(ai.close).result()
                    else:
                        ai.close()
                except Exception:
                    pass
            if executor:
                try:
                    executor.shutdown(wait=False)
                except Exception:
                    pass

    def is_retryable_error(self, err: str | Exception) -> bool:
        import re
        msg = str(err).lower()
        text_keywords = (
            "unauthorized", "unauthenticated", "invalid cookie", "cookie expired",
            "session expired", "rate limit", "please try again later", "401", "429"
        )
        if any(kw in msg for kw in text_keywords):
            return True
        return bool(re.search(r'\b(401|429|403)\b', msg))
