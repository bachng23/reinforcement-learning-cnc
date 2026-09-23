"""Run the deterministic planning facade for any v3 RunDecisionCaseRequest JSON."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


AI_SERVICES_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVICES_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICES_ROOT))

from domain.operations.contracts import RunDecisionCaseRequest
from domain.operations.service import DecisionPlanningService


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("request", type=Path, help="v3 RunDecisionCaseRequest JSON")
    arguments = parser.parse_args()
    request = RunDecisionCaseRequest.model_validate_json(
        arguments.request.read_text(encoding="utf-8")
    )
    recommendation = DecisionPlanningService().plan(request)
    print(recommendation.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
