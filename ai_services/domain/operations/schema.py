from __future__ import annotations

from typing import Any

from domain.operations.contracts import OperationsContractCatalog


def build_operations_contract_schema() -> dict[str, Any]:
    schema = OperationsContractCatalog.model_json_schema(ref_template="#/$defs/{model}")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "https://pdm-marl.local/contracts/v3/operations-domain.schema.json"
    schema["title"] = "Multi-Agent PdM Operations Contract Catalog v3"
    schema["description"] = (
        "Canonical wire-contract catalog for factory snapshots, integrated schedules, "
        "decision cases, agent/tool observability, validation, recommendations, and "
        "human approval. The catalog wrapper is not a wire payload; consumers use the "
        "models in $defs."
    )
    return schema
