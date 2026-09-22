from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from domain.operations.contracts import (
    AssignmentStatus,
    AssignmentType,
    CandidatePlan,
    ConstraintSeverity,
    ConstraintViolation,
    FactorySnapshot,
    Machine,
    MachineStatus,
    MaintenanceRequest,
    Operation,
    OperationStatus,
    PlanValidation,
    ProductionJob,
    ScheduleAssignment,
    Technician,
    TechnicianStatus,
    TimeWindow,
    ValidationVerdict,
)


VALIDATOR_VERSION = "operations-validator-v1"


@dataclass(frozen=True)
class _ViolationDraft:
    constraint_code: str
    message: str
    entity_refs: tuple[str, ...]
    time_window: TimeWindow | None = None


class OperationsValidatorV1:
    """Deterministic semantic validator for operations contract v3 candidates.

    CandidatePlan.validation is deliberately excluded from both validation logic and
    result identity. The schedule is always evaluated against the supplied snapshot.
    """

    validator_version = VALIDATOR_VERSION

    def validate(
        self,
        factory_snapshot: FactorySnapshot,
        candidate_plan: CandidatePlan,
        *,
        seed: int = 0,
    ) -> PlanValidation:
        if seed < 0:
            raise ValueError("seed must be non-negative")

        assignments = sorted(
            (
                assignment
                for assignment in candidate_plan.schedule.assignments
                if assignment.status is not AssignmentStatus.CANCELLED
            ),
            key=lambda assignment: (
                assignment.start_at,
                assignment.end_at,
                assignment.machine_id,
                assignment.assignment_id,
            ),
        )
        drafts: list[_ViolationDraft] = []
        machines = {
            machine.machine_id: machine for machine in factory_snapshot.machines
        }
        jobs = {job.job_id: job for job in factory_snapshot.jobs}
        operations = {
            operation.operation_id: (job, operation)
            for job in factory_snapshot.jobs
            for operation in job.operations
        }
        technicians = {
            technician.technician_id: technician
            for technician in factory_snapshot.technicians
        }
        requests = {
            request.maintenance_request_id: request
            for request in factory_snapshot.maintenance_requests
        }

        self._check_plan_context(factory_snapshot, candidate_plan, drafts)
        self._check_references(
            assignments,
            machines,
            jobs,
            operations,
            technicians,
            requests,
            drafts,
        )
        self._check_planning_window(factory_snapshot, candidate_plan, assignments, drafts)
        self._check_machine_eligibility(assignments, machines, operations, requests, drafts)
        self._check_machine_overlap(assignments, drafts)
        self._check_precedence(assignments, operations, drafts)
        self._check_technicians(assignments, machines, technicians, requests, drafts)

        validation_id = self._validation_id(factory_snapshot, candidate_plan, seed)
        violations = [
            ConstraintViolation(
                violation_id=self._violation_id(validation_id, index, draft),
                constraint_code=draft.constraint_code,
                severity=ConstraintSeverity.ERROR,
                message=draft.message,
                entity_refs=list(dict.fromkeys(draft.entity_refs)),
                time_window=draft.time_window,
            )
            for index, draft in enumerate(drafts, start=1)
        ]
        return PlanValidation(
            validation_id=validation_id,
            candidate_plan_id=candidate_plan.candidate_plan_id,
            validator_version=self.validator_version,
            verdict=(
                ValidationVerdict.INVALID if violations else ValidationVerdict.VALID
            ),
            validated_at=candidate_plan.generated_at,
            violations=violations,
            simulation_runs=0,
            warnings=[],
        )

    @staticmethod
    def _add(
        drafts: list[_ViolationDraft],
        code: str,
        message: str,
        *refs: str,
        time_window: TimeWindow | None = None,
    ) -> None:
        drafts.append(_ViolationDraft(code, message[:256], tuple(refs), time_window))

    def _check_plan_context(
        self,
        snapshot: FactorySnapshot,
        plan: CandidatePlan,
        drafts: list[_ViolationDraft],
    ) -> None:
        if plan.snapshot_id != snapshot.snapshot_id:
            self._add(
                drafts,
                "UNKNOWN_RESOURCE_REFERENCE",
                f"Candidate references snapshot {plan.snapshot_id}, not {snapshot.snapshot_id}.",
                plan.candidate_plan_id,
                plan.snapshot_id,
            )
        if plan.schedule.factory_id != snapshot.factory_id:
            self._add(
                drafts,
                "UNKNOWN_RESOURCE_REFERENCE",
                f"Schedule references factory {plan.schedule.factory_id}, not "
                f"{snapshot.factory_id}.",
                plan.schedule.schedule_id,
                plan.schedule.factory_id,
            )

    def _check_references(
        self,
        assignments: list[ScheduleAssignment],
        machines: dict[str, Machine],
        jobs: dict[str, ProductionJob],
        operations: dict[str, tuple[ProductionJob, Operation]],
        technicians: dict[str, Technician],
        requests: dict[str, MaintenanceRequest],
        drafts: list[_ViolationDraft],
    ) -> None:
        for assignment in assignments:
            if assignment.machine_id not in machines:
                self._add(
                    drafts,
                    "UNKNOWN_RESOURCE_REFERENCE",
                    f"Assignment {assignment.assignment_id} references unknown machine "
                    f"{assignment.machine_id}.",
                    assignment.assignment_id,
                    assignment.machine_id,
                )

            if assignment.assignment_type is AssignmentType.PRODUCTION:
                if assignment.job_id not in jobs:
                    self._add(
                        drafts,
                        "UNKNOWN_RESOURCE_REFERENCE",
                        f"Assignment {assignment.assignment_id} references unknown job "
                        f"{assignment.job_id}.",
                        assignment.assignment_id,
                        assignment.job_id or "unknown-job",
                    )
                operation_entry = operations.get(assignment.operation_id)
                if operation_entry is None:
                    self._add(
                        drafts,
                        "UNKNOWN_RESOURCE_REFERENCE",
                        f"Assignment {assignment.assignment_id} references unknown "
                        f"operation {assignment.operation_id}.",
                        assignment.assignment_id,
                        assignment.operation_id or "unknown-operation",
                    )
                elif operation_entry[0].job_id != assignment.job_id:
                    self._add(
                        drafts,
                        "UNKNOWN_RESOURCE_REFERENCE",
                        f"Operation {assignment.operation_id} does not belong to job "
                        f"{assignment.job_id}.",
                        assignment.assignment_id,
                        assignment.job_id or "unknown-job",
                        assignment.operation_id or "unknown-operation",
                    )

            if assignment.assignment_type is AssignmentType.MAINTENANCE:
                if assignment.maintenance_request_id not in requests:
                    self._add(
                        drafts,
                        "UNKNOWN_RESOURCE_REFERENCE",
                        f"Assignment {assignment.assignment_id} references unknown "
                        f"maintenance request {assignment.maintenance_request_id}.",
                        assignment.assignment_id,
                        assignment.maintenance_request_id or "unknown-request",
                    )
                for technician_id in sorted(assignment.technician_ids):
                    if technician_id not in technicians:
                        self._add(
                            drafts,
                            "UNKNOWN_RESOURCE_REFERENCE",
                            f"Assignment {assignment.assignment_id} references unknown "
                            f"technician {technician_id}.",
                            assignment.assignment_id,
                            technician_id,
                        )

    def _check_planning_window(
        self,
        snapshot: FactorySnapshot,
        plan: CandidatePlan,
        assignments: list[ScheduleAssignment],
        drafts: list[_ViolationDraft],
    ) -> None:
        if plan.schedule.planning_window != snapshot.planning_window:
            self._add(
                drafts,
                "PLANNING_WINDOW",
                "Candidate schedule planning window does not match the factory snapshot.",
                plan.schedule.schedule_id,
                snapshot.snapshot_id,
            )
        for assignment in assignments:
            if (
                assignment.start_at < snapshot.planning_window.start_at
                or assignment.end_at > snapshot.planning_window.end_at
            ):
                self._add(
                    drafts,
                    "PLANNING_WINDOW",
                    f"Assignment {assignment.assignment_id} falls outside the "
                    "snapshot planning window.",
                    assignment.assignment_id,
                    time_window=TimeWindow(
                        start_at=assignment.start_at,
                        end_at=assignment.end_at,
                    ),
                )

    def _check_machine_eligibility(
        self,
        assignments: list[ScheduleAssignment],
        machines: dict[str, Machine],
        operations: dict[str, tuple[ProductionJob, Operation]],
        requests: dict[str, MaintenanceRequest],
        drafts: list[_ViolationDraft],
    ) -> None:
        for assignment in assignments:
            machine = machines.get(assignment.machine_id)
            if assignment.assignment_type is AssignmentType.PRODUCTION:
                operation_entry = operations.get(assignment.operation_id)
                if machine is None or operation_entry is None:
                    continue
                operation = operation_entry[1]
                eligible_ids = {option.machine_id for option in operation.machine_options}
                supported_types = {
                    capability.operation_type for capability in machine.capabilities
                }
                if (
                    machine.machine_id not in eligible_ids
                    or operation.operation_type not in supported_types
                    or machine.status in {MachineStatus.FAILED, MachineStatus.UNAVAILABLE}
                ):
                    self._add(
                        drafts,
                        "MACHINE_ELIGIBILITY",
                        f"Machine {machine.machine_id} is not eligible for operation "
                        f"{operation.operation_id}.",
                        assignment.assignment_id,
                        machine.machine_id,
                        operation.operation_id,
                    )
            elif assignment.assignment_type is AssignmentType.MAINTENANCE:
                request = requests.get(assignment.maintenance_request_id)
                if request is not None and request.machine_id != assignment.machine_id:
                    self._add(
                        drafts,
                        "MACHINE_ELIGIBILITY",
                        f"Maintenance request {request.maintenance_request_id} targets "
                        f"{request.machine_id}, not {assignment.machine_id}.",
                        assignment.assignment_id,
                        request.maintenance_request_id,
                        assignment.machine_id,
                    )

    def _check_machine_overlap(
        self,
        assignments: list[ScheduleAssignment],
        drafts: list[_ViolationDraft],
    ) -> None:
        by_machine: dict[str, list[ScheduleAssignment]] = {}
        for assignment in assignments:
            by_machine.setdefault(assignment.machine_id, []).append(assignment)
        for machine_id in sorted(by_machine):
            ordered = sorted(
                by_machine[machine_id],
                key=lambda item: (item.start_at, item.end_at, item.assignment_id),
            )
            for index, left in enumerate(ordered):
                for right in ordered[index + 1 :]:
                    if right.start_at >= left.end_at:
                        break
                    if left.start_at < right.end_at:
                        self._add(
                            drafts,
                            "MACHINE_CAPACITY_OVERLAP",
                            f"Assignments {left.assignment_id} and "
                            f"{right.assignment_id} overlap on machine {machine_id}.",
                            left.assignment_id,
                            right.assignment_id,
                            machine_id,
                            time_window=TimeWindow(
                                start_at=max(left.start_at, right.start_at),
                                end_at=min(left.end_at, right.end_at),
                            ),
                        )

    def _check_precedence(
        self,
        assignments: list[ScheduleAssignment],
        operations: dict[str, tuple[ProductionJob, Operation]],
        drafts: list[_ViolationDraft],
    ) -> None:
        production = {
            assignment.operation_id: assignment
            for assignment in assignments
            if assignment.assignment_type is AssignmentType.PRODUCTION
            and assignment.operation_id in operations
        }
        for operation_id in sorted(production):
            successor_assignment = production[operation_id]
            operation = operations[operation_id][1]
            for predecessor_id in sorted(operation.predecessor_operation_ids):
                predecessor = operations.get(predecessor_id)
                if predecessor is not None and predecessor[1].status is OperationStatus.COMPLETED:
                    continue
                predecessor_assignment = production.get(predecessor_id)
                if predecessor_assignment is None:
                    self._add(
                        drafts,
                        "PRECEDENCE",
                        f"Operation {operation_id} is scheduled without predecessor "
                        f"{predecessor_id}.",
                        successor_assignment.assignment_id,
                        operation_id,
                        predecessor_id,
                    )
                elif predecessor_assignment.end_at > successor_assignment.start_at:
                    self._add(
                        drafts,
                        "PRECEDENCE",
                        f"Operation {operation_id} starts before predecessor "
                        f"{predecessor_id} finishes.",
                        predecessor_assignment.assignment_id,
                        successor_assignment.assignment_id,
                        predecessor_id,
                        operation_id,
                    )

    def _check_technicians(
        self,
        assignments: list[ScheduleAssignment],
        machines: dict[str, Machine],
        technicians: dict[str, Technician],
        requests: dict[str, MaintenanceRequest],
        drafts: list[_ViolationDraft],
    ) -> None:
        maintenance = [
            assignment
            for assignment in assignments
            if assignment.assignment_type is AssignmentType.MAINTENANCE
        ]
        by_technician: dict[str, list[ScheduleAssignment]] = {}
        for assignment in maintenance:
            for technician_id in sorted(assignment.technician_ids):
                technician = technicians.get(technician_id)
                if technician is None:
                    continue
                by_technician.setdefault(technician_id, []).append(assignment)
                available = (
                    technician.status
                    not in {TechnicianStatus.OFF_SHIFT, TechnicianStatus.UNAVAILABLE}
                    and any(
                        window.start_at <= assignment.start_at
                        and assignment.end_at <= window.end_at
                        for window in technician.availability
                    )
                )
                if not available:
                    self._add(
                        drafts,
                        "TECHNICIAN_AVAILABILITY",
                        f"Technician {technician_id} is unavailable for assignment "
                        f"{assignment.assignment_id}.",
                        assignment.assignment_id,
                        technician_id,
                        time_window=TimeWindow(
                            start_at=assignment.start_at,
                            end_at=assignment.end_at,
                        ),
                    )

            request = requests.get(assignment.maintenance_request_id)
            machine = machines.get(assignment.machine_id)
            if request is None or machine is None:
                continue
            known_team = [
                technicians[technician_id]
                for technician_id in assignment.technician_ids
                if technician_id in technicians
            ]
            for required_skill_id in sorted(request.required_skill_ids):
                adequate = any(
                    skill.skill_id == required_skill_id
                    and skill.level >= request.minimum_skill_level
                    and machine.machine_family in skill.certified_machine_families
                    and request.action_type in skill.certified_action_types
                    for technician in known_team
                    for skill in technician.skills
                )
                if not adequate:
                    self._add(
                        drafts,
                        "TECHNICIAN_SKILL_ADEQUACY",
                        f"No assigned technician has adequate {required_skill_id} skill "
                        f"for {request.action_type} on {machine.machine_family}.",
                        assignment.assignment_id,
                        request.maintenance_request_id,
                        required_skill_id,
                        *assignment.technician_ids,
                    )

        for technician_id in sorted(by_technician):
            ordered = sorted(
                by_technician[technician_id],
                key=lambda item: (item.start_at, item.end_at, item.assignment_id),
            )
            for index, left in enumerate(ordered):
                for right in ordered[index + 1 :]:
                    if right.start_at >= left.end_at:
                        break
                    if left.start_at < right.end_at:
                        self._add(
                            drafts,
                            "TECHNICIAN_AVAILABILITY",
                            f"Technician {technician_id} is double-booked on assignments "
                            f"{left.assignment_id} and {right.assignment_id}.",
                            technician_id,
                            left.assignment_id,
                            right.assignment_id,
                            time_window=TimeWindow(
                                start_at=max(left.start_at, right.start_at),
                                end_at=min(left.end_at, right.end_at),
                            ),
                        )

    def _validation_id(
        self,
        snapshot: FactorySnapshot,
        plan: CandidatePlan,
        seed: int,
    ) -> str:
        payload = {
            "validator_version": self.validator_version,
            "seed": seed,
            "factory_snapshot": snapshot.model_dump(mode="json"),
            "candidate_plan": plan.model_dump(mode="json", exclude={"validation"}),
        }
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return f"validation-{digest[:24]}"

    @staticmethod
    def _violation_id(
        validation_id: str,
        index: int,
        draft: _ViolationDraft,
    ) -> str:
        digest = hashlib.sha256(
            json.dumps(
                {
                    "validation_id": validation_id,
                    "index": index,
                    "code": draft.constraint_code,
                    "message": draft.message,
                    "refs": draft.entity_refs,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        return f"violation-{index:03d}-{digest[:12]}"


def validate_candidate_plan(
    factory_snapshot: FactorySnapshot,
    candidate_plan: CandidatePlan,
    *,
    seed: int = 0,
) -> PlanValidation:
    """Validate one candidate using the stable operations-validator-v1 rules."""

    return OperationsValidatorV1().validate(
        factory_snapshot,
        candidate_plan,
        seed=seed,
    )
