from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, JsonValue, model_validator

from domain.operations.contracts import CandidatePlan, ContractModel, FactorySnapshot, Identifier, ObjectiveWeights, PlanningConfig, Schedule

CONTRACT_VERSION = "scenario-engine:1.0"
ENGINE_VERSION = "scenario-evaluator:1.0.0"
TRANSFORM_VERSION = "scenario-transform:1"
SAMPLING_VERSION = "scenario-crn:1"
HASH_VERSION = "scenario-jcs-sha256:1"
STRICT_PROFILE = "scenario-strict:1"
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Minutes = Annotated[int, Field(strict=True, ge=1, le=43200)]
StrategyId = Literal["production-priority", "balanced", "reliability-priority"]


class ScenarioInputError(ValueError):
    def __init__(self, code: str, message: str, target: str | None = None):
        super().__init__(message)
        self.code, self.target = code, target


class TechnicianUnavailable(ContractModel):
    type: Literal["TECHNICIAN_UNAVAILABLE"]
    technician_id: Identifier
    start_at: AwareDatetime
    end_at: AwareDatetime

    @model_validator(mode="after")
    def interval(self):
        if self.end_at <= self.start_at:
            raise ValueError("unavailable interval must be nonempty")
        return self


class MaintenanceDuration(ContractModel):
    type: Literal["MAINTENANCE_DURATION"]
    maintenance_request_id: Identifier
    expected_duration_minutes: Minutes


class DeferMaintenance(ContractModel):
    type: Literal["DEFER_MAINTENANCE"]
    maintenance_request_id: Identifier
    earliest_start_at: AwareDatetime


Override = Annotated[TechnicianUnavailable | MaintenanceDuration | DeferMaintenance, Field(discriminator="type")]


def override_key(value: Override):
    return value.type, value.technician_id if isinstance(value, TechnicianUnavailable) else value.maintenance_request_id


class ScenarioPlanningConfig(PlanningConfig):
    objective_weights: ObjectiveWeights
    horizon_minutes: Minutes
    candidate_limit: Annotated[int, Field(strict=True, ge=1, le=3)] = 3
    solver_timeout_seconds: Annotated[int, Field(strict=True, ge=1, le=30)] = 30
    simulation_runs: Annotated[int, Field(strict=True, ge=1, le=1000)] = 100
    base_seed: Annotated[int, Field(strict=True, ge=0, le=2147483647)] = 0
    allowed_strategy_ids: list[StrategyId] = Field(min_length=1, max_length=3)

    @model_validator(mode="before")
    @classmethod
    def strict_weights(cls, value):
        if isinstance(value, dict) and isinstance(value.get("objective_weights"), dict):
            weights = value["objective_weights"]
            expected = {"production", "reliability", "maintenance", "workforce", "schedule_stability"}
            if set(weights) != expected or any(type(v) not in (float, int) for v in weights.values()):
                raise ValueError("all five objective weights must be explicit JSON numbers")
        return value

    @model_validator(mode="after")
    def bounds(self):
        if any(weight > 1_000_000 for weight in self.objective_weights.model_dump().values()):
            raise ValueError("objective weight exceeds 1000000")
        return self


class SamplingSpec(ContractModel):
    version: Literal["scenario-crn:1"] = SAMPLING_VERSION
    base_seed: Annotated[int, Field(strict=True, ge=0, le=2147483647)]
    sample_count: Annotated[int, Field(strict=True, ge=1, le=1000)]
    coupling: Literal["COMMON_RANDOM_NUMBERS"] = "COMMON_RANDOM_NUMBERS"


class Identity(ContractModel):
    factory_id: Identifier
    workspace_id: Identifier
    run_id: Identifier
    frozen_input_hash: Hash


class PublicationIdentity(ContractModel):
    schedule_id: Identifier
    schedule_revision: Annotated[int, Field(strict=True, ge=1)]
    schedule_hash: Hash
    plan_version: Annotated[int, Field(strict=True, ge=1)]


class Baseline(ContractModel):
    snapshot: FactorySnapshot
    snapshot_hash: Hash
    publication: PublicationIdentity | None = None

    @model_validator(mode="before")
    @classmethod
    def verify_source_hash(cls, value):
        from domain.scenarios.hashing import content_hash
        if isinstance(value, dict) and "snapshot" in value and "snapshot_hash" in value:
            snapshot = value["snapshot"]
            raw = snapshot.model_dump(mode="json") if isinstance(snapshot, FactorySnapshot) else snapshot
            if content_hash(raw) != value["snapshot_hash"]:
                raise ValueError("INPUT_HASH_MISMATCH: baseline snapshot hash")
        return value


class Budget(ContractModel):
    remaining_ms: Annotated[int, Field(strict=True, ge=1, le=300000)]


def check_precision(value):
    if isinstance(value, datetime) and value.microsecond % 1000:
        raise ValueError("Scenario timestamps must use at most millisecond precision")
    if isinstance(value, dict):
        for item in value.values():
            check_precision(item)
    elif isinstance(value, list):
        for item in value:
            check_precision(item)


class EvaluationRequest(ContractModel):
    contract_version: Literal["scenario-engine:1.0"] = CONTRACT_VERSION
    engine_version: Literal["scenario-evaluator:1.0.0"] = ENGINE_VERSION
    operation: Literal["EVALUATE"] = "EVALUATE"
    identity: Identity
    baseline: Baseline
    reference_publication: Schedule | None = None
    planning_config: ScenarioPlanningConfig
    overrides: list[Override] = Field(default_factory=list, max_length=5)
    sampling: SamplingSpec
    budget: Budget

    @model_validator(mode="before")
    @classmethod
    def publication_hash(cls, value):
        from domain.scenarios.hashing import content_hash
        if isinstance(value, dict) and value.get("reference_publication") is not None:
            baseline = value.get("baseline")
            identity = baseline.publication if isinstance(baseline, Baseline) else (baseline or {}).get("publication")
            expected = identity.schedule_hash if isinstance(identity, PublicationIdentity) else (identity or {}).get("schedule_hash")
            publication = value["reference_publication"]
            raw = publication.model_dump(mode="json") if isinstance(publication, Schedule) else publication
            if content_hash(raw) != expected:
                raise ValueError("reference publication hash mismatch")
        return value

    @model_validator(mode="after")
    def consistency(self):
        snapshot, config = self.baseline.snapshot, self.planning_config
        if snapshot.factory_id != self.identity.factory_id:
            raise ValueError("factory scope mismatch")
        if (snapshot.planning_window.end_at - snapshot.planning_window.start_at).total_seconds() != config.horizon_minutes * 60:
            raise ValueError("horizon must equal the pinned planning window")
        if (config.base_seed, config.simulation_runs) != (self.sampling.base_seed, self.sampling.sample_count):
            raise ValueError("sampling and planning config must match")
        if len({override_key(o) for o in self.overrides}) != len(self.overrides):
            raise ValueError("duplicate override type/target")
        check_precision(self.model_dump())
        publication = self.reference_publication
        identity = self.baseline.publication
        if (publication is None) != (identity is None):
            raise ValueError("publication identity and schedule must both be present or absent")
        if publication is not None:
            from domain.scenarios.hashing import content_hash
            if (publication.factory_id != snapshot.factory_id or publication.schedule_id != identity.schedule_id
                or publication.revision != identity.schedule_revision):
                raise ValueError("reference publication identity/hash mismatch")
        return self


class Diagnostic(ContractModel):
    code: Identifier
    message: Annotated[str, Field(min_length=1, max_length=1000)]
    target_ids: list[Identifier] = Field(default_factory=list)
    field: str | None = None


class EffectiveDiff(ContractModel):
    target_type: Literal["TECHNICIAN", "MAINTENANCE_REQUEST"]
    target_id: Identifier
    field: Literal["availability", "expected_duration_minutes", "earliest_start_at"]
    before: JsonValue
    after: JsonValue


class EffectiveInput(ContractModel):
    transform_version: Literal["scenario-transform:1"] = TRANSFORM_VERSION
    hash_version: Literal["scenario-jcs-sha256:1"] = HASH_VERSION
    source_hash: Hash
    overrides: list[Override]
    snapshot: FactorySnapshot | None
    effective_hash: Hash | None
    diff: list[EffectiveDiff]
    diagnostics: list[Diagnostic] = Field(default_factory=list)


class RankingRow(ContractModel):
    candidate_plan_id: Identifier
    strategy: str
    score: float
    raw_kpis: dict[str, float | int | None]
    metric_benefits: dict[str, float]
    objective_benefits: dict[str, float]
    weighted_contributions: dict[str, float]
    tied_with: list[Identifier]


class Ranking(ContractModel):
    version: Literal["objective-minmax:1"] = "objective-minmax:1"
    normalization_reference_id: Hash
    reference_bounds: dict[str, list[float]]
    constant_range_benefit: Literal[1] = 1
    tie_break: list[str]
    raw_weights: ObjectiveWeights
    normalized_weights: dict[str, float]
    rows: list[RankingRow]


class CandidateAvailability(ContractModel):
    strategy: str
    outcome: Literal["FEASIBLE", "NO_FEASIBLE_PLAN", "TIMEOUT", "NOT_EVALUATED"]
    reason: str | None = None


class Evaluation(ContractModel):
    outcome: Literal["FEASIBLE", "NO_FEASIBLE_PLAN", "TIMEOUT", "FAILED"]
    candidates: list[CandidatePlan] = Field(default_factory=list, max_length=3)
    selected_candidate_id: Identifier | None = None
    ranking: Ranking | None = None
    candidate_availability: list[CandidateAvailability] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    partial: bool = False

    @model_validator(mode="after")
    def valid_selection(self):
        ids = [candidate.candidate_plan_id for candidate in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate candidate identities")
        if self.outcome == "FEASIBLE":
            if not ids or self.selected_candidate_id not in ids or self.ranking is None:
                raise ValueError("feasible evaluation requires selected candidate and ranking")
            if any(candidate.validation.verdict.value != "VALID" for candidate in self.candidates):
                raise ValueError("invalid candidates cannot be returned as usable")
            rows = [row.candidate_plan_id for row in self.ranking.rows]
            if len(rows) != len(ids) or set(rows) != set(ids) or rows[0] != self.selected_candidate_id:
                raise ValueError("ranking and selected candidate mismatch")
        elif ids or self.ranking is not None or self.selected_candidate_id is not None:
            raise ValueError("unsuccessful evaluation cannot contain fabricated candidates")
        return self


class MetricComparison(ContractModel):
    metric: str
    unit: str
    preferred_direction: Literal["LOWER", "HIGHER"]
    baseline: float | int | None
    scenario: float | int | None
    absolute_delta: float | None
    percent_delta: float | None
    reason: str | None
    change: Literal["IMPROVED_UNDER_MODEL", "WORSENED_UNDER_MODEL", "UNCHANGED", "UNAVAILABLE"]


class Comparison(ContractModel):
    metric_registry_version: Literal["scenario-metrics:1"] = "scenario-metrics:1"
    metrics: list[MetricComparison]
    score_comparison: Literal["NOT_COMPARABLE_ACROSS_REFERENCES"] = "NOT_COMPARABLE_ACROSS_REFERENCES"
    model_assumptions: list[str]


class SamplingEvidence(SamplingSpec):
    algorithm: Literal["sha256-first53-uniform:1"]
    observation_set_hash: Hash
    coupling_key: Hash


class LiveMapping(ContractModel):
    supported: bool
    mapped_weights: ObjectiveWeights | None
    mapped_defer_bounds: list[DeferMaintenance]
    reasons: list[str]


class EvaluationResult(ContractModel):
    contract_version: Literal["scenario-engine:1.0"] = CONTRACT_VERSION
    engine_version: Literal["scenario-evaluator:1.0.0"] = ENGINE_VERSION
    identity: Identity
    semantic_input_hash: Hash
    sampling: SamplingEvidence
    effective: EffectiveInput
    baseline: Evaluation
    scenario: Evaluation
    comparison: Comparison
    live_mapping: LiveMapping


WeightName = Literal["production", "reliability", "maintenance", "workforce", "schedule_stability"]


class DurationAxis(ContractModel):
    type: Literal["MAINTENANCE_DURATION"]
    maintenance_request_id: Identifier
    values: list[Minutes] = Field(min_length=1, max_length=7)


class WeightAxis(ContractModel):
    type: Literal["OBJECTIVE_WEIGHT"]
    weight: WeightName
    values: list[Annotated[float, Field(strict=True, ge=0, le=1000000)]] = Field(min_length=1, max_length=7)


class SensitivityRequest(ContractModel):
    contract_version: Literal["scenario-engine:1.0"] = CONTRACT_VERSION
    operation: Literal["SENSITIVITY"] = "SENSITIVITY"
    input: EvaluationRequest
    source_result: EvaluationResult
    source_result_hash: Hash
    axis: Annotated[DurationAxis | WeightAxis, Field(discriminator="type")]

    @model_validator(mode="after")
    def consistent_source(self):
        from domain.scenarios.hashing import content_hash
        if len(set(self.axis.values)) != len(self.axis.values):
            raise ValueError("sweep values must be unique")
        if self.source_result.identity != self.input.identity:
            raise ValueError("source run/workspace/factory identity mismatch")
        if content_hash(self.source_result.model_dump(mode="json")) != self.source_result_hash:
            raise ValueError("source result hash mismatch")
        if self.source_result.effective.source_hash != self.input.baseline.snapshot_hash:
            raise ValueError("source baseline hash mismatch")
        if isinstance(self.axis, WeightAxis):
            for value in self.axis.values:
                weights = {**self.input.planning_config.objective_weights.model_dump(), self.axis.weight: value}
                ObjectiveWeights.model_validate(weights)
        return self


class SensitivityPoint(ContractModel):
    value: float
    input_hash: Hash
    status: Literal["FEASIBLE", "NO_FEASIBLE_PLAN", "FAILED", "TIMEOUT"]
    evaluation: Evaluation
    comparison: Comparison


class RankChangeInterval(ContractModel):
    lower_sample: float
    upper_sample: float
    from_strategy: str
    to_strategy: str
    interpretation: Literal["SAMPLED_INTERVAL_NOT_EXACT_THRESHOLD"] = "SAMPLED_INTERVAL_NOT_EXACT_THRESHOLD"


class SensitivityResult(ContractModel):
    contract_version: Literal["scenario-engine:1.0"] = CONTRACT_VERSION
    engine_version: Literal["scenario-evaluator:1.0.0"] = ENGINE_VERSION
    identity: Identity
    outcome: Literal["COMPLETE", "PARTIAL_FAILED", "FAILED"]
    axis: DurationAxis | WeightAxis
    requested_order: list[float]
    baseline_value: float
    baseline_point: Evaluation
    points: list[SensitivityPoint] = Field(min_length=1, max_length=7)
    rank_change_intervals: list[RankChangeInterval]
    fixed_inputs: list[str]
    sampling: SamplingEvidence


class ComparisonRun(ContractModel):
    input: EvaluationRequest
    result: EvaluationResult
    result_hash: Hash

    @model_validator(mode="after")
    def matching_result(self):
        from domain.scenarios.hashing import content_hash
        if self.input.identity != self.result.identity:
            raise ValueError("comparison input/result identity mismatch")
        if content_hash(self.result.model_dump(mode="json")) != self.result_hash:
            raise ValueError("comparison result hash mismatch")
        if self.result.effective.source_hash != self.input.baseline.snapshot_hash:
            raise ValueError("comparison source hash mismatch")
        return self


class CompareRequest(ContractModel):
    contract_version: Literal["scenario-engine:1.0"] = CONTRACT_VERSION
    operation: Literal["COMPARE"] = "COMPARE"
    runs: list[ComparisonRun] = Field(min_length=2, max_length=4)
    budget: Budget

    @model_validator(mode="after")
    def same_workspace(self):
        first = self.runs[0].input
        ids = [run.input.identity.run_id for run in self.runs]
        if len(set(ids)) != len(ids):
            raise ValueError("comparison requires unique run IDs")
        for run in self.runs:
            source = run.input
            if (source.identity.factory_id, source.identity.workspace_id, source.baseline.snapshot_hash) != (
                first.identity.factory_id, first.identity.workspace_id, first.baseline.snapshot_hash):
                raise ValueError("comparison requires one workspace and pinned source")
        return self


class ComparedRun(ContractModel):
    identity: Identity
    semantic_input_hash: Hash
    planning_config: ScenarioPlanningConfig
    overrides: list[Override]
    engine_version: Literal["scenario-evaluator:1.0.0"] = ENGINE_VERSION
    sampling: SamplingEvidence
    comparison: Comparison


class CompareResult(ContractModel):
    contract_version: Literal["scenario-engine:1.0"] = CONTRACT_VERSION
    engine_version: Literal["scenario-evaluator:1.0.0"] = ENGINE_VERSION
    reference_identity: Identity
    reference_semantic_input_hash: Hash
    reference_planning_config: ScenarioPlanningConfig
    reference_overrides: list[Override]
    reference_sampling: SamplingEvidence
    runs: list[ComparedRun] = Field(min_length=1, max_length=3)
    score_comparison: Literal["NOT_COMPARABLE_ACROSS_REFERENCES"] = "NOT_COMPARABLE_ACROSS_REFERENCES"
