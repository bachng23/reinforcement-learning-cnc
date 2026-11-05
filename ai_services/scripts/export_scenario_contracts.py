"""Generate consumer schemas directly from engine DTOs; --check detects drift."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai_services"))
from domain.scenarios import contracts

MODELS = (contracts.EvaluationRequest, contracts.EvaluationResult,
          contracts.SensitivityRequest, contracts.SensitivityResult,
          contracts.CompareRequest, contracts.CompareResult)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'contracts/scenario/v1')
    args = parser.parse_args()
    for model in MODELS:
        target = args.output / (model.__name__ + '.schema.json')
        schema = model.model_json_schema(mode='validation')
        schema['$schema'] = 'https://json-schema.org/draft/2020-12/schema'
        content = json.dumps(schema, indent=2, sort_keys=True) + '\n'
        if args.check:
            if not target.exists() or target.read_text(encoding='utf-8') != content:
                raise SystemExit(f'Scenario schema drift: {target.name}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf-8')


if __name__ == '__main__':
    main()
