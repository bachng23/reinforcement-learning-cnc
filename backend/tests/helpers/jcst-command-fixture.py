"""Command transaction fixture using actual physical transitions, not learned inference."""
import copy
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys

with contextlib.redirect_stdout(io.StringIO()):
    traces = runpy.run_path(str(Path(__file__).with_name('jcst-context-trace.py')))['snapshots']
request = json.load(sys.stdin)
if request['operation'] == 'demo_init':
    result = copy.deepcopy(traces[0])
    for name in ('primary', 'baseline'):
        result[name]['state'] = result[name]['records'][0]['before']
        result[name]['records'] = []
    result['pending'] = None
elif request['operation'] == 'demo_prepare':
    tick = request['session']['primary']['state']['tick']
    result = copy.deepcopy(traces[tick])
    result['pending'] = None
else:
    raise ValueError('Only explicit transaction-test init/advance supported')
print(json.dumps(result))
