from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def pytest_configure(config):
    config.addinivalue_line("markers", "anyio: run async tests with AnyIO")


import pytest


@pytest.fixture
def anyio_backend():
    return "asyncio"
