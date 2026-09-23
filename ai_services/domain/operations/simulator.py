"""Deterministic KPI calculation and lightweight Monte-Carlo risk simulation."""

from __future__ import annotations

import hashlib
import random
import time
from collections import defaultdict
from datetime import datetime

from domain.operations.contracts import (
    AssignmentStatus,
    AssignmentType,
    FactorySnapshot,
    MaintenanceType,
    PlanKPIs,
    Schedule,
)
from domain.operations.scheduler import PlanningTimeoutError


def _seed_for(seed: int, schedule_id: str) -> int:
    digest = hashlib.sha256(f"{seed}|{schedule_id}".encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


class DeterministicSimulator:
    """Calculates schedule KPIs without relying on fixture-provided values.

    Failure model assumptions are intentionally small and inspectable: a health
    observation is the per-run baseline probability, scheduled maintenance reduces
    it by 70%, and each simulated failure contributes its health horizon in minutes
    of emergency downtime. The pseudo-random generator is seeded per schedule.
    """

    def calculate(
        self,
        snapshot: FactorySnapshot,
        schedule: Schedule,
        *,
        seed: int,
        simulation_runs: int,
        deadline: float | None = None,
    ) -> PlanKPIs:
        active = [
            assignment
            for assignment in schedule.assignments
            if assignment.status is not AssignmentStatus.CANCELLED
        ]
        start_at = snapshot.planning_window.start_at
        makespan = max(
            ((assignment.end_at - start_at).total_seconds() / 60 for assignment in active),
            default=0.0,
        )
        job_completion: dict[str, datetime] = {}
        for assignment in active:
            if assignment.assignment_type is AssignmentType.PRODUCTION and assignment.job_id:
                job_completion[assignment.job_id] = max(
                    job_completion.get(assignment.job_id, assignment.end_at),
                    assignment.end_at,
                )
        tardiness: list[float] = []
        on_time = 0
        for job in snapshot.jobs:
            completion = job_completion.get(job.job_id)
            if completion is None:
                if all(operation.status.value == "COMPLETED" for operation in job.operations):
                    on_time += 1
                    tardiness.append(0.0)
                    continue
                # A missing unfinished job is infeasible in the caller, but retain a
                # bounded metric for diagnostics if a caller requests it directly.
                late = (snapshot.planning_window.end_at - job.due_at).total_seconds() / 60
                tardiness.append(max(0.0, late))
                continue
            late = max(0.0, (completion - job.due_at).total_seconds() / 60)
            tardiness.append(late)
            if late == 0:
                on_time += 1
        job_count = len(snapshot.jobs)
        maintained_machines = {
            assignment.machine_id
            for assignment in active
            if assignment.assignment_type is AssignmentType.MAINTENANCE
        }
        failure_probability, expected_failures, downtime = self._simulate_failures(
            snapshot,
            maintained_machines,
            seed=seed,
            simulation_runs=simulation_runs,
            horizon_minutes=makespan,
            simulation_key=schedule.schedule_id,
            deadline=deadline,
        )
        maintenance_cost = sum(
            self._maintenance_cost(snapshot, assignment.maintenance_request_id)
            for assignment in active
            if assignment.assignment_type is AssignmentType.MAINTENANCE
        )
        technician_utilization = self._technician_utilization(snapshot, active)
        return PlanKPIs(
            makespan_minutes=round(makespan, 6),
            total_tardiness_minutes=round(sum(tardiness), 6),
            maximum_tardiness_minutes=round(max(tardiness, default=0.0), 6),
            on_time_completion_rate=round(on_time / job_count, 6) if job_count else 1.0,
            expected_failure_count=round(expected_failures, 6),
            failure_probability=round(failure_probability, 6),
            expected_emergency_downtime_minutes=round(downtime, 6),
            maintenance_cost=round(maintenance_cost, 6),
            technician_utilization=round(technician_utilization, 6),
            schedule_changes=self._schedule_changes(snapshot, active),
        )

    def _simulate_failures(
        self,
        snapshot: FactorySnapshot,
        maintained_machines: set[str],
        *,
        seed: int,
        simulation_runs: int,
        horizon_minutes: float,
        simulation_key: str,
        deadline: float | None,
    ) -> tuple[float, float, float]:
        if not snapshot.health_snapshots or simulation_runs == 0:
            return 0.0, 0.0, 0.0
        rng = random.Random(_seed_for(seed, simulation_key + str(horizon_minutes)))
        any_failure_runs = 0
        failure_count = 0
        downtime = 0.0
        for run_index in range(simulation_runs):
            if run_index % 128 == 0 and deadline is not None and time.monotonic() >= deadline:
                raise PlanningTimeoutError("planning deadline exceeded during simulation")
            run_failures = 0
            for health in snapshot.health_snapshots:
                probability = health.failure_probability
                if health.machine_id in maintained_machines:
                    probability *= 0.30
                if rng.random() < probability:
                    run_failures += 1
                    downtime += min(
                        float(health.failure_probability_horizon_minutes), horizon_minutes
                    )
            if run_failures:
                any_failure_runs += 1
                failure_count += run_failures
        return (
            any_failure_runs / simulation_runs,
            failure_count / simulation_runs,
            downtime / simulation_runs,
        )

    @staticmethod
    def _maintenance_cost(snapshot: FactorySnapshot, request_id: str | None) -> float:
        request = next(
            (
                item
                for item in snapshot.maintenance_requests
                if item.maintenance_request_id == request_id
            ),
            None,
        )
        if request is None:
            return 0.0
        rate = (
            12.0 if request.maintenance_type is MaintenanceType.CORRECTIVE else 5.0
        )
        return request.expected_duration_minutes * rate

    @staticmethod
    def _technician_utilization(snapshot: FactorySnapshot, active) -> float:
        assigned_minutes: dict[str, float] = defaultdict(float)
        available_minutes: dict[str, float] = defaultdict(float)
        for technician in snapshot.technicians:
            for window in technician.availability:
                available_minutes[technician.technician_id] += (
                    window.end_at - window.start_at
                ).total_seconds() / 60
        for assignment in active:
            if assignment.assignment_type is AssignmentType.MAINTENANCE:
                duration = (
                    assignment.end_at - assignment.start_at
                ).total_seconds() / 60
                for technician_id in assignment.technician_ids:
                    assigned_minutes[technician_id] += duration
        total_available = sum(available_minutes.values())
        if not total_available:
            return 0.0
        return min(1.0, sum(assigned_minutes.values()) / total_available)

    @staticmethod
    def _schedule_changes(snapshot: FactorySnapshot, active) -> int:
        current = snapshot.current_schedule
        if current is None:
            return len(active)
        baseline = {
            (assignment.operation_id or assignment.maintenance_request_id): assignment
            for assignment in current.assignments
            if assignment.operation_id or assignment.maintenance_request_id
        }
        changes = 0
        for assignment in active:
            key = assignment.operation_id or assignment.maintenance_request_id
            if key is None:
                continue
            previous = baseline.get(key)
            if previous is None or (
                previous.machine_id != assignment.machine_id
                or previous.start_at != assignment.start_at
                or previous.end_at != assignment.end_at
                or previous.technician_ids != assignment.technician_ids
            ):
                changes += 1
        return changes
