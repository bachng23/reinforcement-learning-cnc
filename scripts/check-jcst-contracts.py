"""Read-only JCST source/schema/type drift gate. No data collection."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ai_services'))
from domain.jcst.runtime import source_manifest
source_manifest()
with tempfile.TemporaryDirectory(prefix='jcst-contract-') as temp:
    target=Path(temp)/'schema.json'
    subprocess.run([sys.executable,str(ROOT/'ai_services/scripts/export_jcst_contracts.py'),'--output',str(target)],check=True)
    if json.loads(target.read_text()) != json.loads((ROOT/'contracts/jcst/v1/jcst.schema.json').read_text()):
        raise SystemExit('JCST schema drift: regenerate schema')
subprocess.run(['npm.cmd' if sys.platform=='win32' else 'npm','run','contracts:jcst:check'],cwd=ROOT/'frontend',check=True)
print('JCST pinned source, schema and TypeScript checks passed.')
