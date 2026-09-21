# Planning engine interface v1 (draft)

Canonical Python port nằm tại
`ai_services/domain/operations/planning.py`.

```python
class PlanningEngine(Protocol):
    engine_id: str
    engine_version: str

    def plan(self, request: PlanningEngineInput) -> PlanningEngineOutput: ...
```

## Input

`PlanningEngineInput` chứa đúng ba thành phần:

- `factory_snapshot: FactorySnapshot` — immutable basis của lần chạy;
- `trigger: DecisionTrigger` — nguyên nhân replan;
- `config: PlanningConfig` — horizon, candidate limit, timeout, seed và weights.

Engine không đọc mutable factory state ngoài snapshot. Trigger reference phải được
kiểm tra giống `RunDecisionCaseRequest` trước khi gọi engine.

## Output

`PlanningEngineOutput` chứa:

- `candidate_plans: list[CandidatePlan]`;
- `validations: list[PlanValidation]`.

Mỗi candidate phải có đúng một validation theo `candidate_plan_id`; không có ID
trùng hoặc orphan. Nếu candidate embed field `validation`, nội dung đó phải bằng
validation tương ứng trong output. Output có thể chứa `INVALID` để audit/debug,
nhưng recommendation builder chỉ nhận `VALID`.

`ValidationVerdict.ERROR` được trả khi validation không hoàn tất. Engine caller có
thể retry theo policy nhưng không được biến `ERROR` thành `INVALID` hoặc `VALID`.

Interface đồng bộ này là domain port. Worker/RPC adapter có thể chạy bất đồng bộ
nhưng phải giữ nguyên input/output semantics và provenance version.
