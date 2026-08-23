import pytest
from fastapi.testclient import TestClient
from core.server import app

client = TestClient(app)


def test_metaai_models_endpoint():
    response = client.get("/v1/metaai/models")
    assert response.status_code == 200
    data = response.json()
    assert data["object"] == "list"
    models = [m["id"] for m in data["data"]]
    assert "meta-ai" in models
    assert "llama-3.3-70b" in models
    assert "meta-imagine" in models


def test_metaai_unsupported_model():
    response = client.post(
        "/v1/metaai/chat/completions",
        json={
            "model": "unsupported-model-xyz",
            "messages": [{"role": "user", "content": "Hello"}],
        },
    )
    assert response.status_code == 400
    err = response.json()
    assert err["error"]["code"] == "model_not_found"
