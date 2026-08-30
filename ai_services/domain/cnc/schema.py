from __future__ import annotations

from typing import Any

from domain.cnc.contracts import CNCContractCatalog


def build_contract_schema() -> dict[str, Any]:
    schema = CNCContractCatalog.model_json_schema(ref_template="#/$defs/{model}")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "https://pdm-marl.local/contracts/v2/cnc-domain.schema.json"
    schema["title"] = "CNC Tool Replacement Contract Catalog v2"
    schema["description"] = (
        "Canonical schema catalog for the CNC tool replacement research domain. "
        "The catalog wrapper is not a wire payload; consumers use the models in $defs."
    )
    return schema
