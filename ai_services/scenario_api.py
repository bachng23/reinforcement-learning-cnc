"""Internal Scenario transport: bounded isolated processes, no application jobs."""
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from domain.scenarios.contracts import (
    CONTRACT_VERSION, ENGINE_VERSION, SAMPLING_VERSION, STRICT_PROFILE,
    CompareRequest, CompareResult, EvaluationRequest, EvaluationResult, SensitivityRequest, SensitivityResult,
)

router = APIRouter(prefix="/v1/scenarios", tags=["internal-scenario-engine"])
# Per-service concurrency is separate from Backend's per-factory fenced lease.
slots = asyncio.Semaphore(2)
active_processes = set()


def headers(request):
    return {"X-Request-Id": request.headers.get("x-request-id", "scenario")[:128],
            "X-Correlation-Id": request.headers.get("x-correlation-id", request.headers.get("x-request-id", "scenario"))[:128],
            "Cache-Control": "no-store"}


def error_response(request, status, code, message, retryable=False):
    return JSONResponse(status_code=status, headers=headers(request), content={
        "contract_version": CONTRACT_VERSION, "error": {"code": code, "message": message,
        "retryable": retryable}, "correlation_id": headers(request)["X-Correlation-Id"]})


@router.get("/capabilities")
async def capabilities():
    return {"contract_version": CONTRACT_VERSION, "engine_version": ENGINE_VERSION,
            "sampling_version": SAMPLING_VERSION, "constraint_profile": STRICT_PROFILE,
            "operations": ["EVALUATE", "SENSITIVITY", "COMPARE"], "max_points": 7, "max_candidates": 3,
            "max_draws": 1000, "max_solver_seconds": 30, "max_job_seconds": 300,
            "live_defer_supported": True}


async def bounded_read(stream, maximum):
    parts, size = [], 0
    while True:
        part = await stream.read(65536)
        if not part:
            return b"".join(parts)
        size += len(part)
        if size > maximum:
            raise ValueError("Engine output exceeds transport policy")
        parts.append(part)


async def terminate(process):
    if process.returncode is None:
        if sys.platform == "win32":
            # The venv executable can be a launcher with an interpreter child.
            killer = await asyncio.create_subprocess_exec("taskkill", "/PID", str(process.pid), "/T", "/F",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await killer.wait()
            await process.wait()
            return
        try:
            process.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(process.wait(), timeout=2)
        except TimeoutError:
            process.kill()
            await process.wait()


async def execute(payload, request, response_type):
    # Preserve the validated wire representation: reserializing Pydantic models
    # inserts defaults and normalizes timestamps, invalidating pinned input hashes.
    raw = await request.json()
    budget = raw["input"]["budget"] if isinstance(payload, SensitivityRequest) else raw["budget"]
    deadline = time.monotonic() + budget["remaining_ms"] / 1000
    encoded = json.dumps(raw).encode()
    if len(encoded) > 8 * 1024 * 1024:
        return error_response(request, 413, "INPUT_TOO_LARGE", "Scenario input exceeds transport size limit")
    process = None
    tasks = []
    acquired = False
    try:
        # Queue wait is part of the caller's remaining budget, never a fresh timeout.
        while not acquired:
            if await request.is_disconnected():
                raise asyncio.CancelledError()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            try:
                await asyncio.wait_for(slots.acquire(), min(0.05, remaining))
                acquired = True
            except TimeoutError:
                continue
        remaining_ms = int((deadline - time.monotonic()) * 1000)
        if remaining_ms < 1:
            raise TimeoutError()
        budget["remaining_ms"] = remaining_ms
        process = await asyncio.create_subprocess_exec(sys.executable, "-m", "domain.scenarios.worker", "--parent-pid", str(os.getpid()),
            cwd=Path(__file__).parent, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        active_processes.add(process)
        process.stdin.write(json.dumps(raw).encode())
        await process.stdin.drain()
        process.stdin.close()
        stdout = asyncio.create_task(bounded_read(process.stdout, 64 * 1024 * 1024))
        stderr = asyncio.create_task(bounded_read(process.stderr, 65536))
        completion = asyncio.create_task(process.wait())
        tasks = [stdout, stderr, completion]
        while not all(task.done() for task in tasks):
            if await request.is_disconnected():
                raise asyncio.CancelledError()
            if time.monotonic() >= deadline:
                raise TimeoutError()
            for task in tasks:
                if task.done() and task.exception():
                    raise task.exception()
            await asyncio.sleep(0.02)
        value = json.loads(stdout.result())
        if completion.result() != 0:
            error = value.get("error", {})
            return error_response(request, 422 if completion.result() == 2 else 500,
                error.get("code", "ENGINE_FAILURE"), error.get("message", "Scenario evaluation failed"), completion.result() != 2)
        validated = response_type.model_validate(value)
        return JSONResponse(content=validated.model_dump(mode="json"), headers=headers(request))
    except TimeoutError:
        return error_response(request, 504, "ENGINE_TIMEOUT", "Scenario job budget exhausted", True)
    except asyncio.CancelledError:
        raise
    except Exception:
        return error_response(request, 503, "ENGINE_UNAVAILABLE", "Scenario engine transport failed", True)
    finally:
        if process is not None:
            await terminate(process)
            active_processes.discard(process)
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if acquired:
            slots.release()


@router.post("/evaluate", response_model=EvaluationResult)
async def evaluate(payload: EvaluationRequest, request: Request):
    return await execute(payload, request, EvaluationResult)


@router.post("/sensitivity", response_model=SensitivityResult)
async def sensitivity(payload: SensitivityRequest, request: Request):
    return await execute(payload, request, SensitivityResult)


@router.post("/compare", response_model=CompareResult)
async def comparison(payload: CompareRequest, request: Request):
    return await execute(payload, request, CompareResult)
