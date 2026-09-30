# CNC Research AI Service

This package owns two canonical contract families and the operations planning service:

- `domain/cnc`: v2 CNC tool-replacement research contracts.
- `domain/operations`: v3 multi-agent production, maintenance, technician, and decision-support contracts.

Operations decisions use a read-only specialist analysis followed by the deterministic
planning engine and `OperationsValidatorV1`. Specialists collect structured health,
technician, and production-impact evidence; they do not select a strategy, mutate the
snapshot, commit a schedule, or bypass validation.

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

Operations endpoints:

- `POST /v1/operations/plan`: deterministic planner facade.
- `POST /v1/operations/agent-plan`: specialist analysis followed by the same planner.
- `POST /internal/v1/operations/agent-analysis`: structured read-only diagnostics.
- `GET /internal/v1/operations/agent-catalog`: agent/tool allowlists.

The optional narrative workflow uses OpenRouter only when explicitly invoked. Configure
`OPENROUTER_API_KEY` and `OPENROUTER_MODEL`; optional bounds are
`OPENROUTER_TIMEOUT_MS` (1,000–60,000), `OPENROUTER_MAX_RETRIES` (0–3), and
`OPENROUTER_QUEUE_TIMEOUT_SECONDS` (1–120). Concurrent model calls are capped at four.
LLM evidence references and standalone numeric claims are checked against structured tool
output before the workflow accepts them. Provider failures never produce a partial
`RecommendationPackage`.

Per-run diagnostics expose latency, tool failure rate, grounded narrative count/rate, and
candidate feasibility rate. These metrics are internal and therefore do not affect the
canonical deterministic recommendation payload.

Canonical contract documentation:

- [CNC research contract v2](../contracts/v2/README.md)
- [Operations and multi-agent contract v3](../contracts/v3/README.md)
