import os
import base64
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from core.utils import extract_images, cleanup_files, extract_text
from core.routers.gemini import router as gm_router


@pytest.mark.asyncio
async def test_extract_images_base64():
    # 1x1 transparent PNG data URI
    png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    data_uri = f"data:image/png;base64,{png_b64}"

    content = [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": data_uri}},
    ]

    text = extract_text(content)
    assert text == "What is in this image?"

    files = await extract_images(content)
    assert len(files) == 1
    file_path = files[0]
    assert os.path.exists(file_path)
    assert file_path.endswith(".png")

    with open(file_path, "rb") as f:
        data = f.read()
    assert data == base64.b64decode(png_b64)

    cleanup_files(files)
    assert not os.path.exists(file_path)


@pytest.mark.asyncio
async def test_extract_images_jpeg_string_url():
    jpeg_b64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
    data_uri = f"data:image/jpeg;base64,{jpeg_b64}"

    content = [
        {"type": "text", "text": "Describe"},
        {"type": "image_url", "image_url": data_uri},
    ]

    files = await extract_images(content)
    assert len(files) == 1
    assert files[0].endswith(".jpg")
    cleanup_files(files)


def test_gemini_vision_chat_completion():
    app = FastAPI()

    @app.middleware("http")
    async def fake_session(request: Request, call_next):
        request.state.session_data = {}
        request.state.virtual_session_id = "test-session"
        return await call_next(request)

    app.include_router(gm_router, prefix="/v1/gemini")

    mock_client = MagicMock()
    app.state.gemini_client = mock_client

    class MockOutput:
        def __init__(self, text="This is an image of a red circle.", thoughts=""):
            self.text = text
            self.thoughts = thoughts

    captured_files = []

    async def mock_generate_content(prompt=None, files=None, model=None, chat=None):
        if files:
            captured_files.extend(files)
            # verify files exist on disk during execution
            for f in files:
                assert os.path.exists(f)
        return MockOutput()

    mock_client.generate_content = AsyncMock(side_effect=mock_generate_content)

    with TestClient(app) as test_client:
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        response = test_client.post(
            "/v1/gemini/chat/completions",
            json={
                "model": "gemini-3-flash",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Analyze image"},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png_b64}"}}
                        ]
                    }
                ],
                "stream": False,
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["choices"][0]["message"]["content"] == "This is an image of a red circle."
        assert len(captured_files) == 1
        # After completion, temp file should have been cleaned up
        assert not os.path.exists(captured_files[0])
