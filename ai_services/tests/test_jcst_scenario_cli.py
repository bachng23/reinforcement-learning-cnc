"""Harness/contract tests; none claims registered-policy acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('scenario_cli', ROOT / 'scripts/jcst-demo-scenarios.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def catalogue():
    return json.loads((ROOT / 'docs/research/demo-scenarios.json').read_text())


def test_unassigned_scenarios_are_reported_and_shared_seed_is_executed_once():
    data = catalogue()
    for entry in data['scenarios']:
        if entry['id'] in ('DEMO-02', 'DEMO-03'):
            entry['seed'] = None
    specs, missing = cli.catalogue_specs(data)
    assert missing == ['DEMO-02', 'DEMO-03']
    assert len(specs) == 1
    assert [entry['id'] for entries in specs.values() for entry in entries] == ['DEMO-01', 'DEMO-04']


@pytest.mark.parametrize('key,value', [('seed','123'), ('seed',990000001), ('case','invented'),
    ('mode','fake'), ('controller','heuristic')])
def test_reject_unsupported_catalogue_inputs(key, value):
    data = catalogue()
    data['scenarios'][0][key] = value
    with pytest.raises(ValueError):
        cli.catalogue_specs(data)


def test_duplicate_ids_and_missing_requested_ids_fail_closed():
    data = catalogue()
    data['scenarios'].append(data['scenarios'][0])
    with pytest.raises(ValueError):
        cli.catalogue_specs(data)
    data['scenarios'] = data['scenarios'][:1]
    with pytest.raises(ValueError):
        cli.catalogue_specs(data, ['DEMO-04'])


def test_replay_checks_expected_milestone_instead_of_only_scenario_category():
    session = {'primary': {'records': [{'events': [{'type':'failure','tick':5,'machine':2,'component':1}]}]}}
    expected = [{'event':'failure','tick':5,'machineIndex':2,'componentIndex':1}]
    assert cli.milestones_match(session, expected)
    expected[0]['tick'] = 6
    assert not cli.milestones_match(session, expected)


def test_invalid_milestone_fields_are_not_silently_ignored():
    data = catalogue()
    data['scenarios'][0]['milestones'] = [{'tick':5,'event':'failure','machineIndex':2,'componentIndex':1,'invented':True}]
    with pytest.raises(ValueError):
        cli.catalogue_specs(data)


def test_output_cap_refuses_partial_or_oversized_artifact(tmp_path):
    destination = tmp_path / 'trace.json'
    with pytest.raises(OverflowError):
        cli.write(destination, {'payload': 'x' * 1000}, max_bytes=50)
    assert not list(tmp_path.iterdir())


def test_no_registry_is_blocked_zero_seeds_and_does_not_overwrite_evidence(tmp_path):
    output = tmp_path / 'preflight'
    env = {key:value for key,value in os.environ.items() if key not in ('JCST_PYTHON','JCST_RELEASE_REGISTRY')}
    args = [sys.executable, str(ROOT / 'scripts/jcst-demo-scenarios.py'), 'verify', '--output', str(output)]
    first = subprocess.run(args, env=env, capture_output=True, timeout=15)
    assert first.returncode == 2
    saved = (output / 'verification.json').read_bytes()
    report = json.loads(saved)
    assert report['status'] == 'BLOCKED'
    assert report['seedsExecuted'] == 0 and report['browserAcceptance'] == 'NOT_RUN'
    second = subprocess.run(args, env=env, capture_output=True, timeout=15)
    assert second.returncode != 0
    assert (output / 'verification.json').read_bytes() == saved


def test_owned_process_is_reaped_on_stop():
    process = subprocess.Popen([sys._base_executable, '-c', 'import time; time.sleep(60)'])
    try:
        cli.stop(process)
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


@pytest.mark.parametrize('interrupted', [False, True])
def test_timeout_and_interruption_persist_failure_without_claiming_verification(tmp_path, monkeypatch, interrupted):
    registry = tmp_path / 'registry.json'
    registry.write_text('{}')
    output = tmp_path / 'results'
    monkeypatch.setenv('JCST_RELEASE_REGISTRY', str(registry))
    monkeypatch.setenv('JCST_PYTHON', sys.executable)
    monkeypatch.setattr(sys, 'argv', ['cli', 'search', '--output', str(output), '--per-seed-seconds', '.001'])
    # Only the orchestration lifecycle is under test; no fake policy result.
    class PendingProcess:
        def poll(self):
            if interrupted:
                raise KeyboardInterrupt()
            return None
    owned = PendingProcess()
    reaped = []
    monkeypatch.setattr(cli.subprocess, 'check_output', lambda args, **kwargs: 'a' * 40 if 'rev-parse' in args else '')
    monkeypatch.setattr(cli.subprocess, 'Popen', lambda *args, **kwargs: owned)
    monkeypatch.setattr(cli, 'stop', lambda process: reaped.append(process))
    # Avoid changing the pytest process's signal handler.
    monkeypatch.setattr(cli.signal, 'signal', lambda *args: None)
    assert cli.main() == (130 if interrupted else 1)
    report = json.loads((output / 'verification.json').read_text())
    assert report['status'] == ('INTERRUPTED' if interrupted else 'FAILED')
    assert report['runs'][0]['status'] == ('INTERRUPTED' if interrupted else 'TIMEOUT')
    assert reaped == [owned]
    assert report['browserAcceptance'] == 'NOT_RUN'
