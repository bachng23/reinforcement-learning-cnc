from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from domain.operations.contracts import (
    ErrorDetail,
    ErrorResponse,
    RecommendationPackage,
    RunDecisionCaseRequest,
)
from domain.operations.service import (
    DecisionPlanningError,
    DecisionPlanningService,
    NoFeasiblePlan,
    PlanningTimedOut,
)


app = FastAPI(
    title="CNC Research AI Service",
    version="0.1.0",
)

planning_service = DecisionPlanningService()


def _error_response(
    *,
    code: str,
    message: str,
    correlation_id: str,
    retryable: bool = False,
    details: list[ErrorDetail] | None = None,
) -> ErrorResponse:
    return ErrorResponse(
        error_id=f"error-{code.lower()}",
        code=code,
        message=message[:256],
        correlation_id=correlation_id[:128] or "request",
        retryable=retryable,
        details=details or [],
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    details = [
        ErrorDetail(
            field=".".join(str(item) for item in error["loc"])[:256],
            code="REQUEST_VALIDATION_ERROR",
            message=str(error["msg"])[:256],
        )
        for error in exc.errors()
    ]
    payload = _error_response(
        code="REQUEST_VALIDATION_ERROR",
        message="Request does not conform to the operations contract.",
        correlation_id=request.headers.get("x-correlation-id", "request"),
        details=details,
    )
    return JSONResponse(status_code=422, content=payload.model_dump(mode="json"))


@app.get("/health")
async def health() -> dict[str, str | list[str]]:
    return {
        "status": "ok",
        "service": "cnc-research-ai",
        "contract_versions": ["2.0", "3.0"],
    }


@app.post(
    "/v1/operations/plan",
    response_model=RecommendationPackage,
    responses={
        409: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def plan_operations(request: RunDecisionCaseRequest, http_request: Request) -> RecommendationPackage | JSONResponse:
    correlation_id = http_request.headers.get("x-correlation-id") or http_request.headers.get("x-request-id") or request.decision_case_id
    try:
        return planning_service.plan(request)
    except NoFeasiblePlan as exc:
        payload = _error_response(
            code=exc.code,
            message="No feasible plan satisfies the requested resources and windows.",
            correlation_id=correlation_id,
            details=[ErrorDetail(code=exc.code, message=str(exc)[:256])],
        )
        return JSONResponse(status_code=409, content=payload.model_dump(mode="json"))
    except PlanningTimedOut as exc:
        payload = _error_response(
            code=exc.code,
            message="Planning exceeded its configured time limit before finding a valid plan.",
            correlation_id=correlation_id,
            retryable=True,
            details=[ErrorDetail(code=exc.code, message=str(exc)[:256])],
        )
        return JSONResponse(status_code=504, content=payload.model_dump(mode="json"))
    except DecisionPlanningError as exc:
        payload = _error_response(
            code=exc.code,
            message="Planning could not complete.",
            correlation_id=correlation_id,
            retryable=True,
        )
        return JSONResponse(status_code=500, content=payload.model_dump(mode="json"))
    except Exception:
        payload = _error_response(
            code="INTERNAL_PLANNING_ERROR",
            message="Planning failed internally.",
            correlation_id=correlation_id,
            retryable=True,
        )
        return JSONResponse(status_code=500, content=payload.model_dump(mode="json"))
