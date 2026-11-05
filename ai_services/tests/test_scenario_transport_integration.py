"""Real Node consumer -> real TCP FastAPI -> isolated Python planner."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

import httpx
import pytest

from domain.scenarios.hashing import content_hash
from test_scenario_transform import engine_payload, duration

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def service(tmp_path_factory):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log_path = tmp_path_factory.mktemp('scenario-service') / 'uvicorn.log'
    with log_path.open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', str(port)],
                                   cwd=ROOT / 'ai_services', stdout=log, stderr=subprocess.STDOUT)
        url = f'http://127.0.0.1:{port}'
        try:
            deadline = time.monotonic() + 15
            while True:
                if process.poll() is not None:
                    pytest.fail(log_path.read_text())
                try:
                    if httpx.get(url + '/health', timeout=.5).status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                if time.monotonic() > deadline:
                    pytest.fail('FastAPI readiness timeout: ' + log_path.read_text())
                time.sleep(.05)
            yield url
        finally:
            if sys.platform == 'win32' and process.poll() is None:
                # Windows venv python is a launcher; terminating only it leaves
                # the actual interpreter and listening socket behind.
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               capture_output=True, timeout=5, check=True)
            else:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    with socket.socket() as sock:
        assert sock.connect_ex(('127.0.0.1', port)) != 0, 'FastAPI leaked its listening port'


def node_request(service, payload):
    node = shutil.which('node')
    assert node, 'Node is required for actual Backend consumer acceptance'
    script = """
const { ScenarioEngineClient } = require('./backend/src/services/scenario-engine.client');
let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', part => input += part);
process.stdin.on('end', async () => {
  try {
    const result = await new ScenarioEngineClient().execute(JSON.parse(input),
      {requestId: 'integration-request', correlationId: 'integration-correlation'});
    process.stdout.write(JSON.stringify(result));
  } catch (error) { process.stderr.write(error.code || error.message); process.exitCode = 1; }
});
"""
    result = subprocess.run([node, '-e', script], input=json.dumps(payload), text=True,
        capture_output=True, cwd=ROOT, timeout=25,
        env={**os.environ, 'AI_SERVICE_URL': service, 'OPERATIONS_PYTHON': sys.executable})
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_backend_real_evaluation_replay_sweeps_and_comparison(service):
    payload = engine_payload([duration(30)])
    payload['budget']['remaining_ms'] = 20000
    first = node_request(service, payload)
    assert first['scenario']['outcome'] == 'FEASIBLE'
    assert first == node_request(service, payload)
    for axis in [
        {'type': 'MAINTENANCE_DURATION', 'maintenance_request_id': 'MR1', 'values': [30, 60, 90, 91, 120]},
        {'type': 'OBJECTIVE_WEIGHT', 'weight': 'production', 'values': [0, .5, 1, 2, 4]},
    ]:
        sweep = node_request(service, {'operation': 'SENSITIVITY', 'input': payload,
            'source_result': first, 'source_result_hash': content_hash(first), 'axis': axis})
        assert sweep['outcome'] == 'COMPLETE'
        assert len(sweep['points']) == 5
        if axis['type'] == 'MAINTENANCE_DURATION':
            assert [point['status'] for point in sweep['points']] == ['FEASIBLE'] * 3 + ['NO_FEASIBLE_PLAN'] * 2
        else:
            assert all(point['evaluation']['candidates'] == first['scenario']['candidates'] for point in sweep['points'])
    second_input = engine_payload([duration(60)])
    second_input['identity']['run_id'] = 'run-two'
    second = node_request(service, second_input)
    comparison = node_request(service, {'operation': 'COMPARE', 'budget': {'remaining_ms': 20000},
        'runs': [{'input': payload, 'result': first, 'result_hash': content_hash(first)},
                 {'input': second_input, 'result': second, 'result_hash': content_hash(second)}]})
    assert comparison['score_comparison'] == 'NOT_COMPARABLE_ACROSS_REFERENCES'
    metrics = comparison['runs'][0]['comparison']['metrics']
    makespan = next(metric for metric in metrics if metric['metric'] == 'makespan_minutes')
    assert makespan['absolute_delta'] == 30
    assert comparison['runs'][0]['overrides'] == second_input['overrides']
