"""Independent Node reference for RFC8785-compatible JSON and SHA53 sampling."""
import json
import shutil
import subprocess

from domain.scenarios.hashing import content_hash
from domain.scenarios.sampling import CommonRandomDraws
from test_scenario_evaluation import canonical_request


def test_shared_hash_and_sampling_against_independent_node_reference():
    request = canonical_request()
    draws = CommonRandomDraws(request.baseline.snapshot, request.sampling)
    health = request.baseline.snapshot.health_snapshots[0]
    observation = draws.observations[health.health_snapshot_id]
    vectors = [None, {'z': 1.0, 'a': [True, 1e-7, 1e20, -0.0, 'Tiếng Việt']},
               {'\U0001f600': 1, '\ufffd': 2},
               ['scenario-crn:1', request.sampling.base_seed, *observation, 0],
               ['scenario-crn:1', request.sampling.base_seed, *observation, 99]]
    script = r"""
const {createHash} = require('node:crypto');
const canonical = v => v !== null && typeof v === 'object'
  ? Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
    : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : JSON.stringify(v);
let input=''; process.stdin.on('data', d => input+=d);
process.stdin.on('end', () => process.stdout.write(JSON.stringify(JSON.parse(input).map(v => {
  const digest = createHash('sha256').update(canonical(v)).digest();
  return {hash:digest.toString('hex'), draw:Number(digest.readBigUInt64BE() >> 11n) / 2**53};
}))));
"""
    node = shutil.which('node')
    assert node, 'Node required for cross-language hash vectors'
    result = subprocess.run([node, '-e', script], input=json.dumps(vectors), text=True,
                            capture_output=True, timeout=10, check=True)
    reference = json.loads(result.stdout)
    assert [content_hash(vector) for vector in vectors] == [value['hash'] for value in reference]
    assert draws(health, 0) == reference[-2]['draw']
    assert draws(health, 99) == reference[-1]['draw']
