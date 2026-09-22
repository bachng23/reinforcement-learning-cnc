from fastapi import FastAPI


app = FastAPI(
    title="CNC Research AI Service",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, str | list[str]]:
    return {
        "status": "ok",
        "service": "cnc-research-ai",
        "contract_versions": ["2.0", "3.0"],
    }
