"""Forced HTTP owner death must also stop its detached calculation."""
import subprocess
import sys
import time
from pathlib import Path


def test_worker_guard_exits_after_forced_owner_death(tmp_path):
    # Use the interpreter, not Windows' venv launcher, so Popen owns the PID
    # under test directly. The guard itself has no third-party dependencies.
    python = sys._base_executable
    owner = subprocess.Popen([python, '-c', 'import time; time.sleep(60)'])
    worker = None
    ready = tmp_path / 'watcher-ready'
    try:
        worker = subprocess.Popen([python, '-c',
            'import sys,time; from domain.scenarios.process_guard import watch_parent; '
            'watch_parent(int(sys.argv[1])); '
            'from pathlib import Path; Path(sys.argv[2]).write_text("ready"); time.sleep(60)', str(owner.pid), str(ready)],
            cwd=Path(__file__).resolve().parents[1])
        deadline = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        assert ready.exists() and worker.poll() is None
        owner.kill()
        owner.wait(timeout=5)
        assert worker.wait(timeout=5) == 1
    finally:
        for process in (worker, owner):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=5)
