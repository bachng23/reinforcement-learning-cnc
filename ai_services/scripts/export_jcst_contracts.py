from pathlib import Path
import argparse
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from domain.jcst.contracts import Catalog

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "contracts/jcst/v1/jcst.schema.json")
args = parser.parse_args()
schema = Catalog.model_json_schema()
schema.update({"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "JCST Research Contract Catalog v1"})
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(schema, indent=2) + "\n")
