from __future__ import annotations

import hashlib
import json
from math import isclose
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Seed = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]{0,77})$")]
Natural = Annotated[int, Field(strict=True, ge=0)]
Positive = Annotated[int, Field(strict=True, gt=0)]
Cost = Annotated[float, Field(ge=0)]
Action = list[tuple[Natural, Natural, Natural]]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class ComponentConfig(Model):
    scale: float = Field(gt=0)
    shape: float = Field(gt=0)


class Config(Model):
    version: Literal["JCST/1.1"] = "JCST/1.1"
    components: list[list[ComponentConfig]] = Field(min_length=1, max_length=4)
    duration: list[list[list[Natural]]]
    preventive_cost: Cost
    corrective_cost: Cost
    unavailable_cost: Cost
    failure_cost: Cost

    @model_validator(mode="after")
    def dimensions(self):
        if len(self.components) != len(self.duration):
            raise ValueError("duration machine dimension")
        k = len(self.duration[0][0]) if self.duration and self.duration[0] else 0
        if not 1 <= k <= 3:
            raise ValueError("supported technician count is 1..3")
        for components, rows in zip(self.components, self.duration):
            if not components or len(components) != len(rows) or len(components) > 2:
                raise ValueError("component dimension")
            if any(len(row) != k or not any(row) or max(row) > 64 for row in rows):
                raise ValueError("duration/compatibility dimension")
        return self


class ComponentState(Model):
    age: Natural
    failed: bool = Field(strict=True)


class ServiceJob(Model):
    machine: Natural
    component: Natural
    technician: Natural
    kind: Literal["PM", "CM"]
    remaining: Positive


class State(Model):
    tick: Natural
    components: list[list[ComponentState]]
    jobs: list[ServiceJob | None]


class Breakdown(Model):
    preventive: Cost
    corrective: Cost
    unavailable: Cost
    failure: Cost


class Event(Model):
    type: Literal["start", "failure", "occupancy", "completion"]
    tick: Natural
    machine: Natural
    component: Natural
    technician: Natural | None = None
    kind: Literal["PM", "CM"] | None = None
    duration: Positive | None = None
    remaining: Positive | None = None
    uniform: float | None = Field(default=None, ge=0, lt=1)

    @model_validator(mode="after")
    def event_fields(self):
        required = {"start": ("technician", "kind", "duration"), "completion": ("technician", "kind"),
                    "occupancy": ("technician", "remaining"), "failure": ("uniform",)}[self.type]
        if any(getattr(self,name) is None for name in required):
            raise ValueError("missing physical event fields")
        return self


class Record(Model):
    phase: Literal["H", "tail"]
    tick: Natural
    before: State
    action: Action
    catalogue: list[Action]
    after: State
    cost: Cost
    breakdown: Breakdown
    events: list[Event]

    @model_validator(mode="after")
    def coherent(self):
        if self.before.tick != self.tick or self.after.tick != self.tick + 1:
            raise ValueError("tick chain mismatch")
        if not isclose(self.cost, sum(self.breakdown.model_dump().values()), abs_tol=1e-8):
            raise ValueError("cost breakdown mismatch")
        return self


class Episode(Model):
    episode_id: Identifier
    case_id: Identifier
    controller: Identifier
    physical_seed: Seed
    seed_role: Literal["engineering", "evaluation", "confirmation"]
    mode: Literal["greedy", "stochastic"] = "greedy"
    training_root: str | None = None
    checkpoint_samples: Positive | None = None
    action_repetition: Natural = 0
    horizon: Positive = Field(le=96)
    tail: Natural = Field(le=32)
    config: Config
    records: list[Record] = Field(min_length=1, max_length=128)
    controlled_cost: Cost
    tail_cost: Cost
    total_cost: Cost

    @model_validator(mode="after")
    def complete(self):
        if len(self.records) != self.horizon + self.tail:
            raise ValueError("complete H+tail trace required")
        h = tail = 0.0
        previous = None
        for tick, record in enumerate(self.records):
            if record.tick != tick or record.phase != ("H" if tick < self.horizon else "tail"):
                raise ValueError("record phase/order")
            if previous is not None and record.before != previous:
                raise ValueError("broken state chain")
            previous = record.after
            if record.phase == "H":
                h += record.cost
            else:
                tail += record.cost
        if not all(isclose(a, b, abs_tol=1e-8) for a, b in (
            (h, self.controlled_cost), (tail, self.tail_cost), (h + tail, self.total_cost)
        )):
            raise ValueError("H/tail/total mismatch")
        return self


class Artifact(Model):
    artifact_id: Identifier
    media_type: Literal["application/json", "text/csv", "text/markdown"]
    sha256: Digest
    content: str = Field(max_length=6_000_000)

    @model_validator(mode="after")
    def intact(self):
        if hashlib.sha256(self.content.encode("utf-8")).hexdigest() != self.sha256:
            raise ValueError("artifact hash mismatch")
        return self


class Provenance(Model):
    repository: Literal["https://github.com/AIVIETNAM-AIO-BachNguyen/maintenance-capacity-coordination"]
    commit: Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
    source_hash: Digest
    protocol_id: Identifier
    protocol_hash: Digest
    simulator_version: Literal["JCST/1.1"] = "JCST/1.1"


class CurvePoint(Model):
    case_id: Identifier
    arm: Identifier
    training_root: str
    samples: Positive
    mode: Literal["greedy", "stochastic"] = "greedy"
    mean_total_cost: Cost
    mean_h_cost: Cost | None = None
    mean_tail_cost: Cost | None = None
    training_seconds: Cost | None = None

    @model_validator(mode="after")
    def cost_identity(self):
        if self.mean_h_cost is not None and self.mean_tail_cost is not None and not isclose(
            self.mean_total_cost, self.mean_h_cost + self.mean_tail_cost, abs_tol=1e-7
        ):
            raise ValueError("curve H/tail/total mismatch")
        return self


class Contrast(Model):
    case_id: Identifier
    contrast: str = Field(min_length=1, max_length=64)
    estimand: str = Field(min_length=1, max_length=256)
    difference: float
    interval: tuple[float, float]
    interval_method: str = Field(min_length=1, max_length=256)
    gate: Literal["PASS", "FAIL", "NOT_ASSESSED"]

    @model_validator(mode="after")
    def ordered(self):
        if self.interval[0] > self.interval[1]:
            raise ValueError("interval order")
        return self


class SourceAudit(Model):
    kind: Literal["physical", "statistical"]
    status: Literal["PASS", "FAIL", "NOT_AVAILABLE"]
    artifact_id: Identifier
    scope: str = Field(min_length=1, max_length=512)


class Bundle(Model):
    wire_schema_version: Literal["jcst-research/1.0"] = "jcst-research/1.0"
    campaign_key: Identifier
    title: str = Field(min_length=1, max_length=160)
    objective: str = Field(min_length=1, max_length=3000)
    study_key: Identifier
    run_key: Identifier
    origin: Literal["engineering", "research"]
    provenance: Provenance
    claims: list[str] = Field(default_factory=list, max_length=20)
    limitations: list[str] = Field(default_factory=list, max_length=20)
    artifacts: list[Artifact] = Field(min_length=1, max_length=20)
    analysis_artifact_id: Identifier | None = None
    curves: list[CurvePoint] = Field(default_factory=list, max_length=2000)
    contrasts: list[Contrast] = Field(default_factory=list, max_length=50)
    source_audits: list[SourceAudit] = Field(default_factory=list, max_length=10)
    episodes: list[Episode] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def references(self):
        ids = [a.artifact_id for a in self.artifacts]
        if len(set(ids)) != len(ids) or len({e.episode_id for e in self.episodes}) != len(self.episodes):
            raise ValueError("duplicate artifact/episode identity")
        if self.analysis_artifact_id is not None and self.analysis_artifact_id not in ids:
            raise ValueError("missing analysis artifact")
        for audit in self.source_audits:
            if audit.artifact_id not in ids:
                raise ValueError("missing audit artifact")
        if (self.curves or self.contrasts) and self.analysis_artifact_id is None:
            raise ValueError("results require an analysis artifact")
        if self.analysis_artifact_id:
            artifact = next(a for a in self.artifacts if a.artifact_id == self.analysis_artifact_id)
            projection = json.loads(artifact.content)
            if projection.get("format") != "jcst-analysis-projection/1.0":
                raise ValueError("unsupported analysis projection")
            # Compare normalized models so omitted default fields cannot change meaning.
            curves = [CurvePoint.model_validate(p) for p in projection.get("curves", [])]
            contrasts = [Contrast.model_validate(p) for p in projection.get("contrasts", [])]
            if curves != self.curves or contrasts != self.contrasts:
                raise ValueError("results differ from original projection artifact")
            if not projection.get("source_artifact_ids") or any(a not in ids for a in projection["source_artifact_ids"]):
                raise ValueError("projection requires original source artifacts")
        for audit in self.source_audits:
            source = next(a for a in self.artifacts if a.artifact_id == audit.artifact_id)
            if json.loads(source.content).get("status") != audit.status:
                raise ValueError("audit status differs from source report")
        keys = [(p.case_id, p.arm, p.training_root, p.samples, p.mode) for p in self.curves]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate root/checkpoint identity")
        if self.origin == "engineering" and any(e.seed_role != "engineering" for e in self.episodes):
            raise ValueError("engineering bundle cannot contain scientific evaluation rows")
        return self


class BranchRequest(Model):
    episode_id: Identifier
    tick: Natural
    action: Action
    reason: str = Field(min_length=1, max_length=1000)
    expected_episode_hash: Digest
    controller: Literal["threshold5", "risk", "corrective", "wait"] = "risk"


class Catalog(Model):
    bundle: Bundle
    branch_request: BranchRequest
    state: State
    config: Config
