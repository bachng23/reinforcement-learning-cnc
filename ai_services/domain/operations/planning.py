from __future__ import annotations

from typing import Protocol

from pydantic import Field, model_validator

from domain.operations.contracts import (
    CandidatePlan,
    ContractModel,
    DecisionTrigger,
    FactorySnapshot,
    HealthAlertTrigger,
    MachineFailureTrigger,
    MaintenanceRequestedTrigger,
    PlanValidation,
    PlanningConfig,
    TechnicianUnavailableTrigger,
)


class PlanningEngineInput(ContractModel):
    """Stable v1 input boundary for an integrated planning engine."""

    factory_snapshot: FactorySnapshot
    trigger: DecisionTrigger
    config: PlanningConfig

    @model_validator(mode="after")
    def validate_trigger_reference(self) -> PlanningEngineInput:
        machine_ids = {machine.machine_id for machine in self.factory_snapshot.machines}
        technician_ids = {
            technician.technician_id for technician in self.factory_snapshot.technicians
        }
        request_ids = {
            request.maintenance_request_id
            for request in self.factory_snapshot.maintenance_requests
        }
        if isinstance(self.trigger, (HealthAlertTrigger, MachineFailureTrigger)):
            if self.trigger.machine_id not in machine_ids:
                raise ValueError("planning trigger references an unknown machine")
        if isinstance(self.trigger, TechnicianUnavailableTrigger):
            if self.trigger.technician_id not in technician_ids:
                raise ValueError("planning trigger references an unknown technician")
        if isinstance(self.trigger, MaintenanceRequestedTrigger):
            if self.trigger.maintenance_request_id not in request_ids:
                raise ValueError("planning trigger references an unknown maintenance request")
        return self


class PlanningEngineOutput(ContractModel):
    """Candidates and their one-to-one validation results.

    A planning implementation may internally generate infeasible candidates, but it
    must return an explicit validation for every candidate. Recommendation building
    remains a separate step and may consume only candidates with a VALID verdict.
    """

    candidate_plans: list[CandidatePlan] = Field(min_length=1, max_length=5)
    validations: list[PlanValidation] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def validate_result_alignment(self) -> PlanningEngineOutput:
        plan_ids = [plan.candidate_plan_id for plan in self.candidate_plans]
        validation_plan_ids = [
            validation.candidate_plan_id for validation in self.validations
        ]
        if len(plan_ids) != len(set(plan_ids)):
            raise ValueError("planning output candidate_plan_id values must be unique")
        if len(validation_plan_ids) != len(set(validation_plan_ids)):
            raise ValueError(
                "planning output validation candidate_plan_id values must be unique"
            )
        if set(plan_ids) != set(validation_plan_ids):
            raise ValueError("every candidate plan requires exactly one validation")

        validation_by_plan = {
            validation.candidate_plan_id: validation for validation in self.validations
        }
        for plan in self.candidate_plans:
            if plan.validation is not None and plan.validation != validation_by_plan[
                plan.candidate_plan_id
            ]:
                raise ValueError(
                    "embedded candidate validation must match the output validation"
                )
        return self


class PlanningEngine(Protocol):
    """Synchronous planning-engine port; adapters may wrap it in jobs or RPC."""

    engine_id: str
    engine_version: str

    def plan(self, request: PlanningEngineInput) -> PlanningEngineOutput: ...
