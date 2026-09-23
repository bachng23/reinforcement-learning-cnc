"""Deterministic, dependency-free schedule construction for operations v1."""

from __future__ import annotations

import hashlib
import itertools
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from domain.operations.contracts import (
    AssignmentStatus,
    AssignmentType,
    FactorySnapshot,
    Machine,
    MachineStatus,
    MaintenanceRequest,
    MaintenanceRequestStatus,
    PlanStrategy,
    ProductionJob,
    Schedule,
    ScheduleAssignment,
    Technician,
    TechnicianStatus,
)


class NoFeasiblePlanError(Exception):
    """Raised when the snapshot cannot produce a complete feasible schedule."""


class PlanningTimeoutError(Exception):
    """Raised when a planning deadline expires before a candidate is complete."""


@dataclass(frozen=True)
class ScheduledCandidate:
    strategy: PlanStrategy
    schedule: Schedule
    assumptions: list[str]


def _stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"


def _active_request(request: MaintenanceRequest) -> bool:
    return request.status not in {
        MaintenanceRequestStatus.COMPLETED,
        MaintenanceRequestStatus.CANCELLED,
    }


def _overlaps(
    start_at: datetime, end_at: datetime, assignment: ScheduleAssignment
) -> bool:
    return start_at < assignment.end_at and assignment.start_at < end_at


class DeterministicScheduler:
    """Greedy scheduler with stable ordering and no mutable external state.

    A candidate is a full desired schedule. Locked/running/completed entries from a
    current schedule are retained as reservations; ordinary committed work is
    replanned and later counted by the KPI simulator as schedule change.
    """

    def __init__(self, snapshot: FactorySnapshot, deadline: float) -> None:
        self.snapshot = snapshot
        self.deadline = deadline
        self.machines = {machine.machine_id: machine for machine in snapshot.machines}
        self.health_probability = {
            health.machine_id: health.failure_probability
            for health in snapshot.health_snapshots
        }
        self.machine_calendar: dict[str, list[ScheduleAssignment]] = {
            machine.machine_id: [] for machine in snapshot.machines
        }
        self.technician_calendar: dict[str, list[ScheduleAssignment]] = {
            technician.technician_id: [] for technician in snapshot.technicians
        }

    def build(self, strategy: PlanStrategy, decision_case_id: str) -> ScheduledCandidate:
        self._check_deadline()
        assignments = self._locked_assignments()
        self._seed_calendars(assignments)
        requests = sorted(
            (request for request in self.snapshot.maintenance_requests if _active_request(request)),
            key=lambda request: (
                not request.mandatory,
                request.latest_start_at or self.snapshot.planning_window.end_at,
                request.earliest_start_at,
                request.maintenance_request_id,
            ),
        )

        if strategy is PlanStrategy.PRODUCTION_PRIORITY:
            self._schedule_production(assignments, strategy)
            self._schedule_maintenance(assignments, requests, strategy)
        else:
            self._schedule_maintenance(assignments, requests, strategy)
            self._schedule_production(assignments, strategy)

        schedule_id = _stable_id(
            "schedule",
            decision_case_id,
            self.snapshot.snapshot_id,
            strategy.value,
        )
        current_revision = (
            self.snapshot.current_schedule.revision
            if self.snapshot.current_schedule
            else 0
        )
        schedule = Schedule(
            schedule_id=schedule_id,
            factory_id=self.snapshot.factory_id,
            revision=current_revision + 1,
            planning_window=self.snapshot.planning_window,
            created_at=self.snapshot.captured_at,
            assignments=sorted(
                assignments,
                key=lambda assignment: (
                    assignment.start_at,
                    assignment.end_at,
                    assignment.machine_id,
                    assignment.assignment_id,
                ),
            ),
        )
        return ScheduledCandidate(
            strategy=strategy,
            schedule=schedule,
            assumptions=[
                "Greedy deterministic scheduling uses half-open assignment intervals.",
                "Locked, running, and completed current assignments remain reservations.",
            ],
        )

    def _check_deadline(self) -> None:
        if time.monotonic() >= self.deadline:
            raise PlanningTimeoutError("planning deadline exceeded")

    def _locked_assignments(self) -> list[ScheduleAssignment]:
        current = self.snapshot.current_schedule
        if current is None:
            return []
        return [
            assignment
            for assignment in current.assignments
            if assignment.locked
            or assignment.status
            in {AssignmentStatus.RUNNING, AssignmentStatus.COMPLETED}
        ]

    def _seed_calendars(self, assignments: list[ScheduleAssignment]) -> None:
        for assignment in assignments:
            self.machine_calendar[assignment.machine_id].append(assignment)
            for technician_id in assignment.technician_ids:
                self.technician_calendar[technician_id].append(assignment)

    def _schedule_production(
        self, assignments: list[ScheduleAssignment], strategy: PlanStrategy
    ) -> None:
        locked_operations = {
            assignment.operation_id
            for assignment in assignments
            if assignment.assignment_type is AssignmentType.PRODUCTION
        }
        completion = {
            assignment.operation_id: assignment.end_at
            for assignment in assignments
            if assignment.assignment_type is AssignmentType.PRODUCTION
            and assignment.operation_id is not None
        }
        jobs = sorted(
            self.snapshot.jobs,
            key=lambda job: (-job.priority, job.release_at, job.job_id),
        )
        for job in jobs:
            for operation in sorted(
                job.operations, key=lambda item: (item.sequence, item.operation_id)
            ):
                self._check_deadline()
                if (
                    operation.status.value == "COMPLETED"
                    or operation.operation_id in locked_operations
                ):
                    continue
                predecessor_end = [
                    completion[predecessor]
                    for predecessor in operation.predecessor_operation_ids
                    if predecessor in completion
                ]
                if len(predecessor_end) != len(operation.predecessor_operation_ids):
                    raise NoFeasiblePlanError(
                        f"operation {operation.operation_id} has no scheduled predecessor"
                    )
                earliest = max([job.release_at, *predecessor_end])
                choice = self._choose_machine(job, operation, earliest, strategy)
                if choice is None:
                    raise NoFeasiblePlanError(
                        f"no machine slot for operation {operation.operation_id}"
                    )
                machine_id, start_at, end_at = choice
                assignment = ScheduleAssignment(
                    assignment_id=_stable_id(
                        "assignment",
                        "production",
                        strategy.value,
                        operation.operation_id,
                    ),
                    assignment_type=AssignmentType.PRODUCTION,
                    status=AssignmentStatus.PROPOSED,
                    machine_id=machine_id,
                    start_at=start_at,
                    end_at=end_at,
                    job_id=job.job_id,
                    operation_id=operation.operation_id,
                )
                assignments.append(assignment)
                self.machine_calendar[machine_id].append(assignment)
                completion[operation.operation_id] = end_at

    def _choose_machine(self, job, operation, earliest: datetime, strategy: PlanStrategy):
        choices: list[tuple[float, str, datetime, datetime]] = []
        for option in operation.machine_options:
            machine = self.machines[option.machine_id]
            if machine.status in {MachineStatus.FAILED, MachineStatus.UNAVAILABLE}:
                continue
            duration = timedelta(minutes=option.processing_minutes)
            slot = self._find_machine_slot(machine.machine_id, earliest, duration)
            if slot is None:
                continue
            start_at, end_at = slot
            risk = self.health_probability.get(machine.machine_id, 0.0)
            finish_minutes = (
                end_at - self.snapshot.planning_window.start_at
            ).total_seconds() / 60
            current_preference = self._current_machine_penalty(
                operation.operation_id, machine.machine_id
            )
            if strategy is PlanStrategy.PRODUCTION_PRIORITY:
                score = finish_minutes + current_preference * 0.01
            elif strategy is PlanStrategy.BALANCED:
                score = finish_minutes + risk * 90 + current_preference * 4
            else:
                score = finish_minutes + risk * 5_000 + current_preference * 15
            choices.append((score, machine.machine_id, start_at, end_at))
        if not choices:
            return None
        _, machine_id, start_at, end_at = min(
            choices, key=lambda item: (item[0], item[1], item[2])
        )
        return machine_id, start_at, end_at

    def _current_machine_penalty(self, operation_id: str, machine_id: str) -> int:
        current = self.snapshot.current_schedule
        if current is None:
            return 0
        for assignment in current.assignments:
            if assignment.operation_id == operation_id:
                return 0 if assignment.machine_id == machine_id else 1
        return 0

    def _schedule_maintenance(
        self,
        assignments: list[ScheduleAssignment],
        requests: list[MaintenanceRequest],
        strategy: PlanStrategy,
    ) -> None:
        for request in requests:
            self._check_deadline()
            slot = self._choose_maintenance_slot(request, strategy)
            if slot is None:
                raise NoFeasiblePlanError(
                    "no qualified technician or machine slot for maintenance "
                    f"{request.maintenance_request_id}"
                )
            technician_ids, start_at, end_at = slot
            assignment = ScheduleAssignment(
                assignment_id=_stable_id(
                    "assignment",
                    "maintenance",
                    strategy.value,
                    request.maintenance_request_id,
                ),
                assignment_type=AssignmentType.MAINTENANCE,
                status=AssignmentStatus.PROPOSED,
                machine_id=request.machine_id,
                start_at=start_at,
                end_at=end_at,
                maintenance_request_id=request.maintenance_request_id,
                technician_ids=list(technician_ids),
            )
            assignments.append(assignment)
            self.machine_calendar[request.machine_id].append(assignment)
            for technician_id in technician_ids:
                self.technician_calendar[technician_id].append(assignment)

    def _choose_maintenance_slot(
        self, request: MaintenanceRequest, strategy: PlanStrategy
    ) -> tuple[tuple[str, ...], datetime, datetime] | None:
        duration = timedelta(minutes=request.expected_duration_minutes)
        latest_start = request.latest_start_at or (
            self.snapshot.planning_window.end_at - duration
        )
        latest_start = min(latest_start, self.snapshot.planning_window.end_at - duration)
        earliest = max(request.earliest_start_at, self.snapshot.planning_window.start_at)
        if strategy is PlanStrategy.BALANCED and latest_start > earliest:
            earliest = earliest + (latest_start - earliest) / 2
        teams = self._qualified_teams(request)
        candidates: list[tuple[datetime, tuple[str, ...], datetime]] = []
        for team in teams:
            slot = self._find_maintenance_slot(
                request.machine_id, team, earliest, latest_start, duration
            )
            if slot is not None:
                start_at, end_at = slot
                candidates.append((start_at, team, end_at))
        if not candidates:
            return None
        start_at, team, end_at = min(candidates, key=lambda item: (item[0], item[1]))
        return team, start_at, end_at

    def _qualified_teams(self, request: MaintenanceRequest) -> list[tuple[str, ...]]:
        machine = self.machines[request.machine_id]
        candidates = [
            technician
            for technician in self.snapshot.technicians
            if technician.status
            not in {TechnicianStatus.OFF_SHIFT, TechnicianStatus.UNAVAILABLE}
            and any(
                skill.skill_id in request.required_skill_ids
                and skill.level >= request.minimum_skill_level
                and machine.machine_family in skill.certified_machine_families
                and request.action_type in skill.certified_action_types
                for skill in technician.skills
            )
        ]
        teams: list[tuple[str, ...]] = []
        for size in range(1, len(candidates) + 1):
            for group in itertools.combinations(candidates, size):
                self._check_deadline()
                covered = {
                    skill.skill_id
                    for technician in group
                    for skill in technician.skills
                    if skill.level >= request.minimum_skill_level
                    and machine.machine_family in skill.certified_machine_families
                    and request.action_type in skill.certified_action_types
                }
                if set(request.required_skill_ids).issubset(covered):
                    teams.append(tuple(technician.technician_id for technician in group))
            if teams:
                return sorted(teams)
        return []

    def _find_machine_slot(
        self, machine_id: str, earliest: datetime, duration: timedelta
    ) -> tuple[datetime, datetime] | None:
        return self._find_slot(
            self.machine_calendar[machine_id],
            max(earliest, self.snapshot.planning_window.start_at),
            duration,
            self.snapshot.planning_window.end_at,
        )

    def _find_maintenance_slot(
        self,
        machine_id: str,
        technician_ids: tuple[str, ...],
        earliest: datetime,
        latest_start: datetime,
        duration: timedelta,
    ) -> tuple[datetime, datetime] | None:
        start_at = earliest
        while start_at <= latest_start:
            self._check_deadline()
            for technician_id in technician_ids:
                technician = next(
                    item
                    for item in self.snapshot.technicians
                    if item.technician_id == technician_id
                )
                available_start = self._availability_start(technician, start_at, duration)
                if available_start is None:
                    return None
                start_at = max(start_at, available_start)
            end_at = start_at + duration
            conflicts = [
                assignment
                for assignment in self.machine_calendar[machine_id]
                if _overlaps(start_at, end_at, assignment)
            ]
            for technician_id in technician_ids:
                conflicts.extend(
                    assignment
                    for assignment in self.technician_calendar[technician_id]
                    if _overlaps(start_at, end_at, assignment)
                )
            if not conflicts:
                return (start_at, end_at) if start_at <= latest_start else None
            start_at = max(assignment.end_at for assignment in conflicts)
        return None

    @staticmethod
    def _availability_start(
        technician: Technician, start_at: datetime, duration: timedelta
    ) -> datetime | None:
        for window in sorted(technician.availability, key=lambda item: item.start_at):
            candidate = max(start_at, window.start_at)
            if candidate + duration <= window.end_at:
                return candidate
        return None

    @staticmethod
    def _find_slot(
        assignments: list[ScheduleAssignment],
        earliest: datetime,
        duration: timedelta,
        end_limit: datetime,
    ) -> tuple[datetime, datetime] | None:
        start_at = earliest
        for assignment in sorted(
            assignments,
            key=lambda item: (item.start_at, item.end_at, item.assignment_id),
        ):
            end_at = start_at + duration
            if end_at <= assignment.start_at:
                break
            if _overlaps(start_at, end_at, assignment):
                start_at = assignment.end_at
        end_at = start_at + duration
        if end_at > end_limit:
            return None
        return start_at, end_at
