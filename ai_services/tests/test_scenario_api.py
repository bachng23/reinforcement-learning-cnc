import copy
import asyncio
import json
import sys

import pytest

from fastapi.testclient import TestClient

from main import app
from scenario_api import active_processes
from domain.scenarios.contracts import EvaluationResult
from domain.scenarios.hashing import content_hash
from test_scenario_transform import engine_payload, duration


def test_real_subprocess_evaluation_preserves_wire_hash_and_replays():
    payload = engine_payload([duration(30)])
    # Node timestamps include milliseconds; the pinned hash belongs to these
    # original bytes/values, not a Pydantic dump with defaults inserted.
    snapshot = payload['baseline']['snapshot']
    def timestamps(value):
        if isinstance(value, dict):
            return {key: timestamps(item) for key, item in value.items()}
        if isinstance(value, list):
            return [timestamps(item) for item in value]
        if isinstance(value, str) and value.endswith(':00Z'):
            return value[:-1] + '.000Z'
        return value
    payload['baseline']['snapshot'] = timestamps(snapshot)
    payload['baseline']['snapshot_hash'] = content_hash(payload['baseline']['snapshot'])
    before = copy.deepcopy(payload)
    with TestClient(app) as client:
        first = client.post('/v1/scenarios/evaluate', json=payload,
                            headers={'x-request-id': 'request-one', 'x-correlation-id': 'correlation-one'})
        assert first.status_code == 200, first.text
        result = EvaluationResult.model_validate(first.json())
        assert result.scenario.outcome == 'FEASIBLE'
        assert result.effective.diff[0].after == 30
        assert result.scenario.candidates[0].schedule != result.baseline.candidates[0].schedule
        assert first.headers['x-correlation-id'] == 'correlation-one'
        assert first.headers['x-request-id'] == 'request-one'
        replay = client.post('/v1/scenarios/evaluate', json=payload)
        assert replay.status_code == 200, replay.text
        assert replay.json() == first.json()
    assert not active_processes
    assert payload == before


def test_invalid_input_is_versioned_and_never_starts_worker():
    payload = engine_payload([duration(30)])
    payload['overrides'][0]['unsupported'] = True
    with TestClient(app) as client:
        response = client.post('/v1/scenarios/evaluate', json=payload)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'INVALID_SCENARIO_INPUT'
    assert response.json()['contract_version'] == 'scenario-engine:1.0'
    assert not active_processes


def test_exhausted_transport_budget_cleans_up_owned_worker():
    payload = engine_payload()
    payload['budget']['remaining_ms'] = 1
    with TestClient(app) as client:
        response = client.post('/v1/scenarios/evaluate', json=payload)
    assert response.status_code == 504, response.text
    assert response.json()['error']['code'] == 'ENGINE_TIMEOUT'
    assert not active_processes


@pytest.mark.parametrize('interruption', ['cancel', 'disconnect'])
def test_transport_interruption_joins_owned_process(monkeypatch, interruption):
    import scenario_api
    payload = engine_payload()
    original_spawn = asyncio.create_subprocess_exec
    children = []

    async def spawn(*args, **kwargs):
        if 'domain.scenarios.worker' in args:
            # A controllably slow process exercises ownership/cancellation, not
            # planner feasibility. Real planner integration is tested separately.
            args = (sys.executable, '-c', 'import sys,time; sys.stdin.read(); time.sleep(30)')
        child = await original_spawn(*args, **kwargs)
        if 'taskkill' not in args:
            children.append(child)
        return child

    class Request:
        headers = {}
        disconnected = False
        async def json(self):
            return copy.deepcopy(payload)
        async def is_disconnected(self):
            return self.disconnected

    async def run():
        request = Request()
        task = asyncio.create_task(scenario_api.execute(
            scenario_api.EvaluationRequest.model_validate(payload), request, EvaluationResult))
        try:
            async with asyncio.timeout(10):
                while not active_processes:
                    await asyncio.sleep(.01)
                if interruption == 'cancel':
                    task.cancel()
                else:
                    request.disconnected = True
                with pytest.raises(asyncio.CancelledError):
                    await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        assert children and all(child.returncode is not None for child in children)
        assert not active_processes

    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    asyncio.run(run())
