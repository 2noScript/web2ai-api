import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Literal

import openai
import pytest
from openai import OpenAI
from pydantic import BaseModel, Field


def resolve_api_key() -> str:
    from_env = os.environ.get("WEB2AI_API_KEY", "").strip()
    if from_env:
        return from_env

    db_path = Path.home() / "Library" / "Application Support" / "com.web2ai.desktop" / "web2ai.db"
    if db_path.is_file():
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            row = conn.execute("SELECT key FROM api_keys WHERE is_active = 1 LIMIT 1").fetchone()
            if row and row[0]:
                return str(row[0])
        finally:
            conn.close()
    return ""


BASE_URL = os.environ.get("WEB2AI_BASE_URL", "http://127.0.0.1:8088/v1")
API_KEY = resolve_api_key()

if not API_KEY:
    pytest.exit("WEB2AI_API_KEY environment variable is required.", returncode=1)


def make_client(session_id: str | None = None) -> OpenAI:
    headers = {"X-Session-Id": session_id} if session_id else None
    return OpenAI(base_url=BASE_URL, api_key=API_KEY, default_headers=headers)


class InvoiceItem(BaseModel):
    name: str
    qty: int = Field(ge=1)
    unit_price: float = Field(ge=0)


class Invoice(BaseModel):
    currency: Literal["USD", "VND"]
    total_amount: float = Field(ge=0)
    items: list[InvoiceItem] = Field(min_length=1)


class CityCard(BaseModel):
    name: str
    country: str


class ServiceOwner(BaseModel):
    team: str
    email: str


class ServiceMeta(BaseModel):
    name: str
    tier: Literal["edge", "core", "worker"]
    owner: ServiceOwner


class ComputeResources(BaseModel):
    cpu_millicores: int = Field(ge=100)
    memory_mb: int = Field(ge=128)


class PortBinding(BaseModel):
    port: int = Field(ge=1, le=65535)
    protocol: Literal["tcp", "udp"]
    public: bool


class EnvironmentSpec(BaseModel):
    env: Literal["staging", "production"]
    replicas: int = Field(ge=1, le=50)
    resources: ComputeResources
    ports: list[PortBinding] = Field(min_length=1)


class RollbackConfig(BaseModel):
    enabled: bool
    max_surge_percent: int = Field(ge=1, le=100)


class DeploymentPlan(BaseModel):
    service: ServiceMeta
    environments: list[EnvironmentSpec] = Field(min_length=2)
    rollback: RollbackConfig
    tags: list[str] = Field(min_length=1)


def _inline_strict_schema(model: type[BaseModel]) -> dict:
    """Resolve Pydantic $defs inline so the schema is self-contained for LLM prompts."""
    raw = model.model_json_schema()
    defs = raw.pop("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_name = node["$ref"].split("/")[-1]
                return resolve(dict(defs[ref_name]))
            out = {k: resolve(v) for k, v in node.items()}
            if out.get("type") == "object":
                out["additionalProperties"] = False
            return out
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(raw)


def test_models_list_only_deepseek():
    client = make_client()
    models = [m.id for m in client.models.list().data]
    assert "deepseek:deepseek-chat" in models
    assert "deepseek:deepseek-reasoner" in models
    assert not any(m.startswith(("gemini:", "metaai:")) for m in models)


@pytest.mark.skipif(
    os.environ.get("WEB2AI_AUTH_ENABLED") != "1",
    reason="Auth enforcement is disabled in debug builds",
)
def test_invalid_api_key_raises_authentication_error():
    bad_client = OpenAI(base_url=BASE_URL, api_key="sk-invalid-test-key")
    with pytest.raises(openai.AuthenticationError) as exc_info:
        bad_client.chat.completions.create(
            model="deepseek:deepseek-chat",
            messages=[{"role": "user", "content": "hi"}],
        )
    assert exc_info.value.status_code == 401


def test_invalid_response_format_raises_bad_request_error():
    client = make_client()
    with pytest.raises(openai.BadRequestError) as exc_info:
        client.chat.completions.create(
            model="deepseek:deepseek-chat",
            messages=[{"role": "user", "content": "hi"}],
            response_format={"type": "xml"},  # type: ignore[arg-type]
        )
    assert exc_info.value.status_code == 400


def test_json_object_non_stream():
    client = make_client(f"py-json-obj-{int(time.time() * 1000)}")
    res = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        messages=[
            {
                "role": "user",
                "content": "Return a JSON object describing Python with keys: name (string), dynamic (boolean).",
            }
        ],
        response_format={"type": "json_object"},
    )
    assert res.object == "chat.completion"
    assert res.choices[0].finish_reason == "stop"
    content = res.choices[0].message.content or ""
    parsed = json.loads(content)
    assert isinstance(parsed, dict)


def test_json_schema_strict_with_pydantic_parse():
    client = make_client(f"py-json-schema-{int(time.time() * 1000)}")
    schema = Invoice.model_json_schema()
    schema["additionalProperties"] = False
    for prop_schema in schema.get("$defs", {}).values():
        if isinstance(prop_schema, dict) and prop_schema.get("type") == "object":
            prop_schema["additionalProperties"] = False

    res = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        messages=[
            {
                "role": "user",
                "content": "Create an invoice for 3 books at 15 USD each, total 45 USD.",
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "invoice",
                "strict": True,
                "schema": schema,
            },
        },
    )
    content = res.choices[0].message.content or ""
    invoice = Invoice.model_validate_json(content)
    assert invoice.currency in ("USD", "VND")
    assert len(invoice.items) >= 1


def test_json_schema_streaming_sse():
    client = make_client(f"py-stream-schema-{int(time.time() * 1000)}")
    schema = CityCard.model_json_schema()
    schema["additionalProperties"] = False

    stream = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        stream=True,
        messages=[
            {
                "role": "user",
                "content": "Describe Paris with name (string) and country (string).",
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "city_card",
                "strict": True,
                "schema": schema,
            },
        },
    )

    chunks: list[str] = []
    finish_reason = None
    for chunk in stream:
        assert chunk.object == "chat.completion.chunk"
        choice = chunk.choices[0]
        if choice.delta.content:
            chunks.append(choice.delta.content)
        if choice.finish_reason:
            finish_reason = choice.finish_reason

    assert finish_reason == "stop"
    card = CityCard.model_validate_json("".join(chunks))
    assert "paris" in card.name.lower()
    assert card.country


def test_multi_turn_session_isolation_between_text_and_json():
    sid = f"py-multiturn-{int(time.time() * 1000)}"
    client = make_client(sid)

    r1 = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        messages=[{"role": "user", "content": "Remember this city name: Hue."}],
    )
    assert (r1.choices[0].message.content or "").strip()

    schema = CityCard.model_json_schema()
    schema["additionalProperties"] = False
    r2 = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        messages=[{"role": "user", "content": "Output the city I mentioned and its country as JSON."}],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "city_card",
                "strict": True,
                "schema": schema,
            },
        },
    )
    card = CityCard.model_validate_json(r2.choices[0].message.content or "")
    assert "hue" in card.name.lower()

    r3 = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        messages=[{"role": "user", "content": "Answer in a short plain sentence: Is Hue in central Vietnam?"}],
    )
    reply3 = (r3.choices[0].message.content or "").strip()
    assert reply3
    assert not reply3.startswith("{")


def test_complex_4_level_nested_pydantic_schema():
    client = make_client(f"py-complex-schema-{int(time.time() * 1000)}")
    schema = _inline_strict_schema(DeploymentPlan)

    res = client.chat.completions.create(
        model="deepseek:deepseek-chat",
        messages=[
            {
                "role": "user",
                "content": (
                    "Generate a Kubernetes deployment plan for service 'auth-gateway' "
                    "(tier: edge, owner team: Security, email: sec@acme.dev). "
                    "Include 2 environments: staging (2 replicas, 300 cpu_millicores, 256 memory_mb, port 8080 tcp private) "
                    "and production (4 replicas, 1500 cpu_millicores, 2048 memory_mb, port 443 tcp public). "
                    "Include rollback enabled=true with max_surge_percent=50 and tags ['security', 'edge']."
                ),
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "deployment_plan",
                "strict": True,
                "schema": schema,
            },
        },
    )

    plan = DeploymentPlan.model_validate_json(res.choices[0].message.content or "")
    assert plan.service.name == "auth-gateway"
    assert plan.service.tier == "edge"
    assert plan.service.owner.email == "sec@acme.dev"
    assert len(plan.environments) >= 2
    assert any(e.env == "production" and e.ports[0].public is True for e in plan.environments)
    assert plan.rollback.enabled is True
    assert len(plan.tags) >= 1
