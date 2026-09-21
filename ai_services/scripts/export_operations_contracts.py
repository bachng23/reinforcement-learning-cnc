from __future__ import annotations

import json
import argparse
import sys
from pathlib import Path

AI_SERVICES_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICES_ROOT))

from domain.operations.schema import build_operations_contract_schema


REPOSITORY_ROOT = AI_SERVICES_ROOT.parent
OUTPUT_PATH = REPOSITORY_ROOT / "contracts" / "v3" / "operations-domain.schema.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(build_operations_contract_schema(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(args.output)


if __name__ == "__main__":
    main()
