from __future__ import annotations

import json
import sys
from pathlib import Path

AI_SERVICES_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICES_ROOT))

from domain.cnc.schema import build_contract_schema


REPOSITORY_ROOT = AI_SERVICES_ROOT.parent
OUTPUT_PATH = REPOSITORY_ROOT / "contracts" / "v2" / "cnc-domain.schema.json"


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(build_contract_schema(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
