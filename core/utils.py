import os
import re
import json
import time
import base64
import mimetypes
import tempfile
from typing import Any
from curl_cffi.requests import AsyncSession


def parse_cookie(cookie_str: str | None, name: str) -> str | None:
    if not cookie_str:
        return None
    m = re.search(rf"(?:^|;\s*){re.escape(name)}=([^;]+)", cookie_str)
    return m.group(1) if m else None


def extract_text(content: str | list | None) -> str:
    if not content:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                t = part.get("text", "")
                if t:
                    texts.append(t)
        return " ".join(texts)
    return str(content)


async def extract_images(content: str | list | None) -> list[str]:
    """
    Extract images from OpenAI-format message content (base64 Data URIs or HTTP/HTTPS URLs),
    save them to temporary files, and return their file paths.
    """
    if not content or not isinstance(content, list):
        return []

    saved_paths: list[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue

        url = None
        part_type = part.get("type")
        if part_type == "image_url":
            img_val = part.get("image_url")
            if isinstance(img_val, dict):
                url = img_val.get("url")
            elif isinstance(img_val, str):
                url = img_val
        elif part_type in ("input_file", "file_url"):
            url = part.get("file_url") or part.get("url")

        if not url or not isinstance(url, str):
            continue

        url = url.strip()

        # Handle Data URI (e.g. data:image/jpeg;base64,....)
        if url.startswith("data:"):
            match = re.match(r"^data:(?:image\/([a-zA-Z0-9\+\-\.]+)|[a-zA-Z0-9\+\-\.]+\/[a-zA-Z0-9\+\-\.]+);base64,(.+)$", url, re.DOTALL)
            if match:
                subtype = match.group(1) or "png"
                b64_data = match.group(2)
                ext = f".{subtype}" if not subtype.startswith(".") else subtype
                if ext == ".jpeg":
                    ext = ".jpg"
                try:
                    file_bytes = base64.b64decode(b64_data)
                    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                        tmp.write(file_bytes)
                        saved_paths.append(tmp.name)
                except Exception:
                    continue
        # Handle HTTP / HTTPS URLs
        elif url.startswith("http://") or url.startswith("https://"):
            try:
                async with AsyncSession() as session:
                    resp = await session.get(url, timeout=15)
                    if resp.status_code == 200:
                        content_type = resp.headers.get("content-type", "")
                        mime = content_type.split(";")[0].strip().lower() if content_type else "image/jpeg"
                        ext = mimetypes.guess_extension(mime) or ".jpg"
                        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                            tmp.write(resp.content)
                            saved_paths.append(tmp.name)
            except Exception:
                continue

    return saved_paths


def cleanup_files(file_paths: list[str]) -> None:
    """Clean up temporary files."""
    for path in file_paths:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass


def make_stream_chunk(
    model: str,
    content: str,
    response_id: str,
    *,
    is_first: bool = False,
    is_final: bool = False,
) -> str:
    delta: dict[str, str] = {}
    if is_first:
        delta["role"] = "assistant"
    if content:
        delta["content"] = content

    choice: dict[str, Any] = {
        "index": 0,
        "delta": delta,
        "finish_reason": "stop" if is_final else None,
    }

    chunk = {
        "id": response_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [choice],
    }
    return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"


def make_error_chunk(error_msg: str, error_type: str = "server_error", code: str = "") -> str:
    data = json.dumps({
        "error": {
            "message": error_msg,
            "type": error_type,
            "code": code,
        }
    }, ensure_ascii=False)
    return f"data: {data}\n\n"


STREAM_END = "data: [DONE]\n\n"







