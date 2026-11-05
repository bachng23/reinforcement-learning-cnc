"""Benchmark the existing real planner before Scenario implementation.

Physical inputs are edited directly in a test clone. This does not exercise a
typed override endpoint, async worker, cancellation or Scenario sampling policy.
"""
import argparse
import json
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from domain.operations.contracts import RunDecisionCaseRequest
from domain.operations.service import DecisionPlanningService, NoFeasiblePlan, PlanningTimedOut


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    fixture = root / "contracts/v3/fixtures/demo-health-alert.json"
    source_text = fixture.read_text(encoding="utf-8")
    source = RunDecisionCaseRequest.model_validate_json(source_text)
    service = DecisionPlanningService()
    measurements = []
    for draws in [100, 1000]:
        for values in [[60], [30, 60, 90, 120, 180], [30, 60, 90, 120, 180, 240, 360]]:
            points = []
            before = time.perf_counter()
            for duration in values:
                raw = source.model_dump(mode="json")
                raw["factory_snapshot"]["maintenance_requests"][0]["expected_duration_minutes"] = duration
                raw["planning_config"]["simulation_runs"] = draws
                request = RunDecisionCaseRequest.model_validate(raw)
                immutable_before = request.model_dump_json()
                point_start = time.perf_counter()
                try:
                    result = service.plan(request)
                    assert all(p.validation.verdict.value == "VALID" for p in result.candidate_plans)
                    point = {"status": "FEASIBLE", "candidate_count": len(result.candidate_plans)}
                except NoFeasiblePlan as exc:
                    point = {"status": "NO_FEASIBLE_PLAN", "reason": str(exc), "candidate_count": 0}
                except PlanningTimedOut as exc:
                    point = {"status": "TIMEOUT", "reason": str(exc), "candidate_count": 0}
                assert request.model_dump_json() == immutable_before
                points.append({"duration_minutes": duration, "elapsed_ms": round((time.perf_counter() - point_start) * 1000, 3), **point})
            total_ms = round((time.perf_counter() - before) * 1000, 3)
            measurements.append({"point_count": len(values), "draws_per_candidate": draws,
                "solver_seconds_per_point": source.planning_config.solver_timeout_seconds,
                "total_ms": total_ms, "median_point_ms": statistics.median(p["elapsed_ms"] for p in points),
                "points": points})
    assert fixture.read_text(encoding="utf-8") == source_text
    report = {
        "kind": "existing_planner_baseline_only_not_scenario_acceptance",
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "source_tree_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()),
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "fixture": str(fixture.relative_to(root)), "measurements": measurements,
        "limitations": ["single local run; no production latency claim", "not the Scenario endpoint or Backend async integration",
                        "direct cloned physical inputs; typed overrides and stable Scenario sampling are not implemented"],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for item in measurements:
        print(f"points={item['point_count']} draws/candidate={item['draws_per_candidate']} total_ms={item['total_ms']}")


if __name__ == "__main__":
    main()
