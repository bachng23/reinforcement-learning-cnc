"""Measure the real typed Scenario callable at bounded point/draw counts."""
import argparse
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'ai_services'))
from domain.scenarios.contracts import EvaluationRequest, SensitivityRequest
from domain.scenarios.evaluation import ScenarioEvaluator
from domain.scenarios.hashing import content_hash
from domain.scenarios.sensitivity import SensitivityEvaluator


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = json.loads((ROOT / 'contracts/v3/fixtures/demo-health-alert.json').read_text())
    measurements = []
    for draws in [100, 1000]:
        config = {**raw['planning_config'], 'simulation_runs': draws,
                  'allowed_strategy_ids': ['production-priority', 'balanced', 'reliability-priority']}
        request = EvaluationRequest.model_validate({'operation': 'EVALUATE',
            'identity': {'factory_id': raw['factory_snapshot']['factory_id'], 'workspace_id': 'benchmark',
                         'run_id': 'benchmark', 'frozen_input_hash': 'a' * 64},
            'baseline': {'snapshot': raw['factory_snapshot'], 'snapshot_hash': content_hash(raw['factory_snapshot'])},
            'planning_config': config, 'sampling': {'base_seed': config['base_seed'], 'sample_count': draws},
            'budget': {'remaining_ms': 300000}})
        before = request.model_dump_json()
        started = time.perf_counter()
        source = ScenarioEvaluator().evaluate(request)
        evaluation_ms = (time.perf_counter() - started) * 1000
        target = request.baseline.snapshot.maintenance_requests[0].maintenance_request_id
        for values in [[60], [30, 60, 90, 120, 180], [30, 60, 90, 120, 180, 240, 360]]:
            for axis in [{'type': 'MAINTENANCE_DURATION', 'maintenance_request_id': target, 'values': values},
                         {'type': 'OBJECTIVE_WEIGHT', 'weight': 'production', 'values': [v / 60 for v in values]}]:
                sweep = SensitivityRequest(input=request, source_result=source,
                    source_result_hash=content_hash(source.model_dump(mode='json')), axis=axis)
                started = time.perf_counter()
                result = SensitivityEvaluator().evaluate(sweep)
                elapsed = (time.perf_counter() - started) * 1000
                assert len(result.points) == len(values)
                assert request.model_dump_json() == before
                assert all(candidate.validation.verdict.value == 'VALID' for point in result.points for candidate in point.evaluation.candidates)
                measurements.append({'type': axis['type'], 'points': len(values), 'draws_per_candidate': draws,
                    'source_evaluation_ms': round(evaluation_ms, 3), 'sweep_ms': round(elapsed, 3),
                    'outcomes': [point.status for point in result.points],
                    'result_hash': content_hash(result.model_dump(mode='json'))})
    report = {'kind': 'real_typed_scenario_callable_benchmark',
        'git_sha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'dirty_tree': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
        'environment': {'python': platform.python_version(), 'platform': platform.platform()},
        'measurements': measurements,
        'limitations': ['Local callable timings; excludes HTTP, application DB, worker leases and browser.',
                        'Not joint product acceptance or a production latency guarantee.']}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
