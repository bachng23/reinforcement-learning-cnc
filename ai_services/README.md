# CNC Research AI Service

This package currently owns the CNC research contracts and a minimal FastAPI process. It intentionally contains no dataset ingestion, legacy predictor, LLM negotiation, message broker, object storage, or experiment runner.

```bash
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Generate and verify the shared contract:

```bash
uv run python scripts/export_cnc_contracts.py
uv run pytest -q
```

The canonical contract documentation is in [../contracts/v2/README.md](../contracts/v2/README.md).
