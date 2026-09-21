"""Read-only contract gate. Run with the ai_services Python environment."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="operations-contract-") as temp:
        generated = Path(temp) / "operations-domain.schema.json"
        run(sys.executable, str(ROOT / "ai_services/scripts/export_operations_contracts.py"),
            "--output", str(generated))
        committed = ROOT / "contracts/v3/operations-domain.schema.json"
        if json.loads(generated.read_text(encoding="utf-8")) != json.loads(committed.read_text(encoding="utf-8")):
            raise SystemExit("Schema drift: run ai_services/scripts/export_operations_contracts.py")
    run(sys.executable, "-m", "pytest", "tests/test_cnc_contracts.py",
        "tests/test_operations_contracts.py", "tests/test_shared_operations_fixtures.py", "-q",
        cwd=ROOT / "ai_services")
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if not npm:
        raise SystemExit("npm is required; install frontend dependencies with npm ci first")
    run(npm, "run", "contracts:check", cwd=ROOT / "frontend")
    run(npm, "run", "typecheck", cwd=ROOT / "frontend")
    run(npm, "exec", "--", "vitest", "run", "tests/operations-api-client.test.ts", cwd=ROOT / "frontend")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
