# CNC Research AI Service

This package owns two independent canonical contract families and a minimal FastAPI process:

- `domain/cnc`: v2 CNC tool-replacement research contracts.
- `domain/operations`: v3 multi-agent production, maintenance, technician, and decision-support contracts.

It intentionally contains no dataset ingestion, legacy predictor, LLM negotiation, message broker, object storage, or experiment runner yet.

```bash
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Generate and verify the shared contract:

```bash
uv run python scripts/export_cnc_contracts.py
uv run python scripts/export_operations_contracts.py
uv run python scripts/export_operations_demo.py
uv run pytest -q
```

Canonical contract documentation:

- [CNC research contract v2](../contracts/v2/README.md)
- [Operations and multi-agent contract v3](../contracts/v3/README.md)
