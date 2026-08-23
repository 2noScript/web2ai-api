from .router import router

METAAI_MODELS = [
    {
        "id": "meta-ai",
        "object": "model",
        "created": 1713400000,
        "owned_by": "meta",
        "description": "Meta AI default assistant model"
    },
    {
        "id": "llama-3.3-70b",
        "object": "model",
        "created": 1733400000,
        "owned_by": "meta",
        "description": "Llama 3.3 70B powered by Meta AI"
    },
    {
        "id": "meta-imagine",
        "object": "model",
        "created": 1713400000,
        "owned_by": "meta",
        "description": "Meta AI Image Generation model"
    }
]

METAAI_MODEL_IDS = {m["id"] for m in METAAI_MODELS}


@router.get(
    "/models",
    summary="List available Meta AI models",
)
async def list_models():
    return {"object": "list", "data": METAAI_MODELS}
