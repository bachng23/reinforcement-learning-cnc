"""Real planner plus opt-in test-only fault routes, bound atomically to port 0.

The parent owns stdin. EOF terminates this process even if the Node runner is
force-killed. No fault endpoints are added to the production FastAPI app.
"""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import threading

import uvicorn
from fastapi import Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "ai_services"))
import main
from domain.operations.contracts import RunDecisionCaseRequest
from domain.operations.service import PlanningTimedOut

app = main.app
requests = []
active_faults = 0


class RecordRequests:
    """Observe bodies without consuming ASGI disconnect events."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        body = bytearray()

        async def observed_receive():
            event = await receive()
            if scope.get("method") == "POST" and event["type"] == "http.request":
                body.extend(event.get("body", b""))
                if not event.get("more_body", False):
                    headers = dict(scope["headers"])
                    requests.append({"path": scope["path"],
                                     "request_id": headers.get(b"x-request-id", b"").decode(),
                                     "correlation_id": headers.get(b"x-correlation-id", b"").decode(),
                                     "body": json.loads(body)})
            return event

        await self.app(scope, observed_receive, send)


app.add_middleware(RecordRequests)


@app.get("/test/requests")
def recorded_requests():
    return requests


@app.get("/test/active")
def active_requests():
    return {"active": active_faults}


@app.post("/faults/{mode}/v1/operations/plan")
async def fault(mode: str, request: Request):
    global active_faults
    payload = await request.json()
    if mode == "422":
        # Use FastAPI's real request-validation handler.
        from fastapi.exceptions import RequestValidationError
        return await main.request_validation_error_handler(request, RequestValidationError([
            {"loc": ("body", "planning_config"), "msg": "test rejection", "type": "value_error"}
        ]))
    if mode == "504":
        # Exercise the production endpoint's actual planning-timeout mapping.
        class TimedOut:
            def plan(self, value):
                raise PlanningTimedOut("test deadline")
        previous = main.planning_service
        try:
            main.planning_service = TimedOut()
            return await main.plan_operations(RunDecisionCaseRequest.model_validate(await request.json()), request)
        finally:
            main.planning_service = previous
    if mode == "409":
        return JSONResponse({"code": "NO_FEASIBLE_PLAN", "retryable": False}, status_code=409)
    if mode in {"500", "503", "503-no-retry", "401", "429"}:
        status = int(mode.split("-")[0])
        return JSONResponse({"retryable": mode in {"500", "503"}}, status_code=status)
    request_id = request.headers.get("x-request-id", "")
    if mode == "retry-once" and sum(
        item["path"] == request.url.path and item["request_id"] == request_id
        for item in requests
    ) == 1:
        return JSONResponse({"retryable": True}, status_code=503)
    if mode == "malformed":
        return Response("{", media_type="application/json")
    if mode == "schema-invalid":
        return JSONResponse({"schema_version": "3.0", "candidate_plans": []})
    if mode == "json-null":
        return JSONResponse(None)
    if mode == "timeout":
        active_faults += 1
        try:
            while not await request.is_disconnected():
                await asyncio.sleep(0.01)
            return Response(status_code=499)
        finally:
            active_faults -= 1
    if mode == "slow-body":
        async def stream():
            global active_faults
            active_faults += 1
            try:
                yield b'{"schema_version":'
                await asyncio.sleep(60)
            finally:
                active_faults -= 1
        return StreamingResponse(stream(), media_type="application/json")
    result = main.planning_service.plan(RunDecisionCaseRequest.model_validate(payload)).model_dump(mode="json")
    if mode == "wrong-factory":
        for plan in result["candidate_plans"]:
            plan["schedule"]["factory_id"] = "other-factory"
    if mode in {"wrong-snapshot", "wrong-case"}:
        field = "snapshot_id" if mode == "wrong-snapshot" else "decision_case_id"
        result[field] = "other-context"
        for plan in result["candidate_plans"]:
            plan[field] = "other-context"
    if mode == "invalid-candidate":
        result["candidate_plans"][0]["validation"]["verdict"] = "INVALID"
        result["candidate_plans"][0]["validation"]["violations"] = [{
            "violation_id": "test-violation", "constraint_code": "TEST_INVALID",
            "severity": "ERROR", "message": "Invalid candidate must not be accepted",
        }]
    return JSONResponse(result)


def main_server():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False,
                                          timeout_graceful_shutdown=1))

    def watch_parent():
        sys.stdin.buffer.read()
        server.should_exit = True
        # CPU-bound planner or startup must not outlive a vanished parent.
        threading.Event().wait(3)
        os._exit(0)

    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"port": listener.getsockname()[1]}), flush=True)
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    main_server()
