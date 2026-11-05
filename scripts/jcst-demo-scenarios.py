"""Bounded engineering-seed search/verification using the existing demo runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).parent))
from jcst_scenario_evidence import classify


def catalogue_specs(catalogue, selected=None):
    if catalogue.get('schemaVersion') != 1 or not isinstance(catalogue.get('scenarios'), list):
        raise ValueError('Unsupported catalogue structure')
    specs, missing, ids = {}, [], set()
    for entry in catalogue['scenarios']:
        identity = entry.get('id')
        if identity not in {f'DEMO-0{i}' for i in range(1, 5)} or identity in ids:
            raise ValueError('Unknown or duplicate scenario identity')
        ids.add(identity)
        if selected and identity not in selected:
            continue
        if entry.get('case') not in ('base', 'generalist') or entry.get('mode') not in ('incident', 'policy') or entry.get('controller') not in ('S', 'F'):
            raise ValueError('Unsupported scenario input')
        seed = entry.get('seed')
        if seed is None:
            missing.append(identity)
            continue
        if not isinstance(seed, str) or len(seed) != 9 or not seed.isascii() or not seed.isdigit() or not 990000000 <= int(seed) <= 999999999:
            raise ValueError('Catalogue seed must be an engineering seed string')
        milestones = entry.get('milestones', [])
        if not isinstance(milestones, list):
            raise ValueError('Invalid milestones')
        for milestone in milestones:
            if set(milestone) - {'tick', 'event', 'machineIndex', 'componentIndex'} or milestone.get('event') not in ('failure', 'start', 'completion'):
                raise ValueError('Unsupported milestone fields')
            for key, maximum in [('tick', 64), ('machineIndex', 2), ('componentIndex', 1)]:
                if type(milestone.get(key)) is not int or not 0 <= milestone[key] <= maximum:
                    raise ValueError('Invalid milestone index or tick')
        key = (entry['case'], entry['mode'], seed, entry['controller'])
        specs.setdefault(key, []).append(entry)
    if selected and set(selected) - ids:
        raise ValueError('Requested scenario absent from catalogue')
    return specs, missing


def milestones_match(session, milestones):
    events = [e for record in session['primary']['records'] for e in record['events']]
    return all(any(e['type'] == m['event'] and e['tick'] == m['tick'] and
                   e.get('machine') == m['machineIndex'] and e.get('component') == m['componentIndex']
                   for e in events) for m in milestones)


def write(path, value, max_bytes=None):
    encoded = (json.dumps(value, indent=2, allow_nan=False) + '\n').encode('utf-8')
    if max_bytes is not None and len(encoded) > max_bytes:
        raise OverflowError('Artifact exceeds output allowance')
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(encoded)
    temporary.replace(path)


def worker(options, destination, max_bytes):
    sys.path.insert(0, str(ROOT / 'ai_services'))
    from domain.jcst.demo import initialize, prepare, commit
    session = initialize(**options)
    while session['status'] != 'COMPLETE':
        if session['status'] == 'REVIEW':
            commit(session, session['pending']['action'], 'automatic', 'Engineering scenario verification; accept registered policy')
        else:
            prepare(session)
    if set(session.get('audits', {})) != {'primary', 'baseline'} or any(a['status'] != 'PASS' for a in session['audits'].values()):
        raise ValueError('Both physical replay audits must PASS')
    write(destination, {'session': session, 'runtime': {'python': platform.python_version(),
          'platform': platform.platform(), 'torch': __import__('torch').__version__}}, max_bytes)


def stop(process):
    if process.poll() is None:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        else:
            process.kill()
        process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['search', 'verify'])
    parser.add_argument('--case', choices=['base', 'generalist'], default='base')
    parser.add_argument('--mode', choices=['incident', 'policy'], default='incident')
    parser.add_argument('--controller', choices=['S', 'F'], default='S')
    parser.add_argument('--seed-start', type=int, default=990000001)
    parser.add_argument('--seed-end', type=int, default=990000001)
    parser.add_argument('--condition', choices=[f'DEMO-0{i}' for i in range(1, 5)], action='append')
    parser.add_argument('--max-seeds', type=int, default=16)
    parser.add_argument('--max-seconds', type=float, default=300)
    parser.add_argument('--per-seed-seconds', type=float, default=120)
    parser.add_argument('--max-output-mib', type=int, default=64)
    parser.add_argument('--near-ticks', type=int, default=2)
    parser.add_argument('--catalogue', type=Path, default=ROOT / 'docs/research/demo-scenarios.json')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # TERM follows the same progress persistence/process cleanup path as Ctrl+C.
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    if not (990000000 <= args.seed_start <= args.seed_end <= 999999999):
        parser.error('Only dedicated engineering seeds are allowed')
    if not (1 <= args.max_seeds <= 1000 and 0 < args.max_seconds <= 3600 and
            0 < args.per_seed_seconds <= 600 and 1 <= args.max_output_mib <= 1024 and args.near_ticks == 2):
        parser.error('Invalid bounded budget; near-failure criterion is fixed at 2 ticks')
    report_reserve = 65536 + args.max_seeds * 4096
    if report_reserve >= args.max_output_mib * 1024**2:
        parser.error('Output budget too small for bounded per-seed progress metadata')
    missing = []
    if args.operation == 'verify':
        try:
            specs, missing = catalogue_specs(json.loads(args.catalogue.read_text(encoding='utf-8')), args.condition)
        except (OSError, ValueError, TypeError, KeyError) as error:
            parser.error(f'Invalid catalogue: {type(error).__name__}')
    else:
        specs = {(args.case, args.mode, str(seed), args.controller):
                 [{'id': identity, 'milestones': []} for identity in args.condition or [f'DEMO-0{i}' for i in range(1, 5)]]
                 for seed in range(args.seed_start, min(args.seed_end + 1, args.seed_start + args.max_seeds))}
    # A new directory prevents overwriting previous evidence or another demo.
    args.output.mkdir(parents=True, exist_ok=False)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    began = time.monotonic()
    report = {'schemaVersion': 1, 'sourceSha': sha, 'sourceDirty': dirty,
        'status': 'RUNNING', 'actor': 'automatic', 'nearFailureMaxTicks': 2,
        'budget': {k: getattr(args, k) for k in ['max_seeds','max_seconds','per_seed_seconds','max_output_mib']},
        'seedsExecuted': 0, 'elapsedSeconds': 0, 'runs': [], 'browserAcceptance': 'NOT_RUN',
        'unassignedScenarios': missing, 'requestedSeedRange': [args.seed_start, args.seed_end] if args.operation == 'search' else None}
    report_path = args.output / 'verification.json'
    write(report_path, report)
    python = os.environ.get('JCST_PYTHON')
    registry = os.environ.get('JCST_RELEASE_REGISTRY')
    if not python or not registry or not Path(registry).is_file():
        report.update(status='BLOCKED', reason='Explicit JCST_PYTHON and existing JCST_RELEASE_REGISTRY required')
        write(report_path, report)
        return 2
    if not specs:
        report.update(status='BLOCKED', reason='No selected catalogue entries have a seed')
        write(report_path, report)
        return 2
    try:
        for (case, mode, seed, primary), entries in list(specs.items())[:args.max_seeds]:
            required = [entry['id'] for entry in entries]
            remaining = args.max_seconds - (time.monotonic() - began)
            used = sum(p.stat().st_size for p in args.output.iterdir() if p.is_file())
            if remaining <= 0 or used >= args.max_output_mib * 1024**2:
                report['budgetExhausted'] = True
                break
            stem = f'{case}-{mode}-{primary}-{seed}'
            trace = args.output / f'{stem}.json'
            options = dict(case=case, mode=mode, seed=seed, primary=primary, baseline='F' if primary == 'S' else 'S')
            item = {'input': options, 'conditions': required, 'status': 'RUNNING'}
            report['runs'].append(item)
            report['seedsExecuted'] += 1
            write(report_path, report)
            started = time.monotonic()
            process = None
            try:
                allowance = args.max_output_mib * 1024**2 - used - report_reserve
                if allowance <= 0:
                    raise OverflowError()
                process = subprocess.Popen([python, str(Path(__file__).resolve()), '--worker', json.dumps(options), str(trace.resolve()), str(allowance)],
                    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                while process.poll() is None:
                    if time.monotonic() - started > min(remaining, args.per_seed_seconds):
                        raise TimeoutError()
                    if sum(p.stat().st_size for p in args.output.iterdir() if p.is_file()) >= args.max_output_mib * 1024**2:
                        raise OverflowError()
                    time.sleep(.05)
                if process.returncode != 0:
                    raise RuntimeError('Runtime or checkpoint validation failed')
                result = json.loads(trace.read_text(encoding='utf-8'))
                evidence = classify(result['session'], args.near_ticks)
                found = {entry['id']: bool(evidence['matches'][entry['id']]) and
                         milestones_match(result['session'], entry.get('milestones', [])) for entry in entries}
                item.update(status='VERIFIED' if all(found.values()) else 'NO_MATCH', found=found,
                    trace=trace.name, traceSha256=hashlib.sha256(trace.read_bytes()).hexdigest(),
                    releases=result['session']['releases'], vendorSourceCommit=result['session']['source_commit'],
                    runtime=result['runtime'], audits=result['session']['audits'])
                remaining_output = args.max_output_mib * 1024**2 - sum(p.stat().st_size for p in args.output.iterdir() if p.is_file()) - report_reserve
                write(args.output / f'{stem}.evidence.json', evidence, remaining_output)
            except KeyboardInterrupt:
                item['status'] = 'INTERRUPTED'
                raise
            except (OSError, ValueError, RuntimeError, TimeoutError, OverflowError) as error:
                item.update(status='TIMEOUT' if isinstance(error, TimeoutError) else 'OUTPUT_LIMIT' if isinstance(error, OverflowError) else 'ERROR',
                            errorType=type(error).__name__)
            finally:
                if process is not None:
                    stop(process)
                item['elapsedSeconds'] = round(time.monotonic() - started, 3)
                report['elapsedSeconds'] = round(time.monotonic() - began, 3)
                write(report_path, report)
    except KeyboardInterrupt:
        report['status'] = 'INTERRUPTED'
        write(report_path, report)
        return 130
    conditions = set(args.condition or [entry['id'] for entries in specs.values() for entry in entries]) | set(missing)
    found = {key: any(run['status'] in ('VERIFIED', 'NO_MATCH') and run.get('found', {}).get(key) for run in report['runs']) for key in conditions}
    report['found'] = found
    report['errors'] = sum(run['status'] in ('ERROR', 'TIMEOUT', 'OUTPUT_LIMIT') for run in report['runs'])
    report['status'] = ('FAILED' if report['errors'] else 'VERIFIED' if all(found.values()) else 'NOT_FOUND_WITHIN_BUDGET')
    write(report_path, report)
    print(json.dumps({'status': report['status'], 'seedsExecuted': report['seedsExecuted'], 'found': found}))
    return 0 if report['status'] == 'VERIFIED' else 1


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--worker':
        worker(json.loads(sys.argv[2]), Path(sys.argv[3]), int(sys.argv[4]))
    else:
        raise SystemExit(main())
