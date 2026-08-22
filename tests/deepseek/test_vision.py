import os
import base64
import pytest
from unittest.mock import MagicMock, patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from core.routers.deepseek import router as ds_router
from deepseek_api.client import DeepSeek


def test_deepseek_upload_file_mock():
    client = DeepSeek(auth_token="Bearer test_token")

    # Create dummy temp image
    tmp_path = "/tmp/test_unit_upload.png"
    with open(tmp_path, "wb") as f:
        f.write(b"PNG_DUMMY_DATA")

    with patch.object(client, "create_pow_challenge", return_value={"challenge": "test"}), \
         patch.object(client, "solve_pow_challenge", return_value=(True, "test_pow_ans")), \
         patch.object(client.session, "post") as mock_post:

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "code": 0,
            "data": {
                "biz_data": {
                    "id": "file-unit-test-12345",
                    "status": "PENDING",
                    "model_kind": "VISION",
                }
            }
        }
        mock_post.return_value = mock_resp

        fid = client.upload_file(tmp_path, model_type="vision")
        assert fid == "file-unit-test-12345"

    if os.path.exists(tmp_path):
        os.remove(tmp_path)


def test_deepseek_vision_chat_completion():
    app = FastAPI()

    @app.middleware("http")
    async def fake_session(request: Request, call_next):
        request.state.session_data = {}
        request.state.virtual_session_id = "test-session"
        return await call_next(request)

    app.include_router(ds_router, prefix="/v1/deepseek")

    mock_client = MagicMock()
    mock_session = MagicMock()
    mock_client.new_session.return_value = mock_session

    captured_files = []

    def mock_send_message(prompt=None, model=None, thinking_enabled=None, model_type=None, files=None):
        if files:
            captured_files.extend(files)
            for f in files:
                assert os.path.exists(f)
        return {
            "ok": True,
            "content": {
                "response": "This image contains Pikachu.",
                "thought": "Thinking about the pokemon...",
            }
        }

    mock_session.send_message.side_effect = mock_send_message

    with patch("core.routers.deepseek.chat.deepseek_strategy.get_or_create_client", return_value=mock_client), \
         TestClient(app) as test_client:
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        response = test_client.post(
            "/v1/deepseek/chat/completions",
            json={
                "model": "deepseek-chat",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Who is in this image?"},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png_b64}"}}
                        ]
                    }
                ],
                "stream": False
            },
            headers={"Authorization": "Bearer dev-key"}
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["choices"][0]["message"]["content"] == "This image contains Pikachu."
        assert len(captured_files) == 1
        # verify temporary file was cleaned up after request finished
        for f in captured_files:
            assert not os.path.exists(f)


def test_deepseek_multiple_images_vision():
    app = FastAPI()

    @app.middleware("http")
    async def fake_session(request: Request, call_next):
        request.state.session_data = {}
        request.state.virtual_session_id = "test-session"
        return await call_next(request)

    app.include_router(ds_router, prefix="/v1/deepseek")

    mock_client = MagicMock()
    mock_session = MagicMock()
    mock_client.new_session.return_value = mock_session

    captured_files = []

    def mock_send_message(prompt=None, model=None, thinking_enabled=None, model_type=None, files=None):
        if files:
            captured_files.extend(files)
            for f in files:
                assert os.path.exists(f)
        return {
            "ok": True,
            "content": {
                "response": "Found 2 images: a green pixel and a red pixel.",
                "thought": "",
            }
        }

    mock_session.send_message.side_effect = mock_send_message

    with patch("core.routers.deepseek.chat.deepseek_strategy.get_or_create_client", return_value=mock_client), \
         TestClient(app) as test_client:
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        response = test_client.post(
            "/v1/deepseek/chat/completions",
            json={
                "model": "deepseek-chat",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Compare these two images:"},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png_b64}"}},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png_b64}"}}
                        ]
                    }
                ],
                "stream": False
            },
            headers={"Authorization": "Bearer dev-key"}
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert "Found 2 images" in data["choices"][0]["message"]["content"]
        assert len(captured_files) == 2
        for f in captured_files:
            assert not os.path.exists(f)

