from __future__ import annotations

from enum import Enum
from math import isclose
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Identifier = Annotated[
    str,
    Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"),
]
Probability = Annotated[float, Field(ge=0.0, le=1.0)]
NonNegativeFloat = Annotated[float, Field(ge=0.0)]
NonNegativeInt = Annotated[int, Field(ge=0)]


class ContractModel(BaseModel):
    model_config = ConfigDict(
        allow_inf_nan=False,
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
    )


class ToolAction(str, Enum):
    CONTINUE = "CONTINUE"
    REPLACE = "REPLACE"


class ExecutionOutcome(str, Enum):
    CONTINUED = "CONTINUED"
    REPLACED = "REPLACED"
    WAITING_FOR_SPARE = "WAITING_FOR_SPARE"
    FAILED = "FAILED"


class RiskObjective(str, Enum):
    EXPECTED_COST = "EXPECTED_COST"
    CVAR = "CVAR"


class CuttingCondition(ContractModel):
    condition_id: Identifier
    load_class: Literal["LIGHT", "NOMINAL", "HEAVY"]


class RULDistribution(ContractModel):
    """Discrete RUL distribution consumed by a policy, measured in simulator steps."""

    support_steps: list[NonNegativeInt] = Field(min_length=2)
    probability_mass: list[Probability] = Field(min_length=2)
    survival_beyond_horizon: Probability
    model_version: Identifier

    @model_validator(mode="after")
    def validate_distribution(self) -> RULDistribution:
        if len(self.support_steps) != len(self.probability_mass):
            raise ValueError("support_steps and probability_mass must have equal length")
        if self.support_steps[0] != 0:
            raise ValueError("support_steps must begin at zero")
        if any(right <= left for left, right in zip(self.support_steps, self.support_steps[1:])):
            raise ValueError("support_steps must be strictly increasing")
        total_probability = sum(self.probability_mass) + self.survival_beyond_horizon
        if not isclose(total_probability, 1.0, rel_tol=0.0, abs_tol=1e-6):
            raise ValueError("probability_mass plus survival_beyond_horizon must sum to one")
        return self


class ToolBeliefState(ContractModel):
    """Observable wear and inferred belief only; simulator latent state is forbidden."""

    tool_age_steps: NonNegativeInt
    observed_wear_um: NonNegativeFloat
    posterior_median_wear_um: NonNegativeFloat
    posterior_std_wear_um: NonNegativeFloat
    rul_distribution: RULDistribution


class MachineObservation(ContractModel):
    machine_id: Identifier
    tool_id: Identifier
    job_id: Identifier | None = None
    cutting_condition: CuttingCondition
    tool_state: ToolBeliefState


class SharedInventoryState(ContractModel):
    spares_available: NonNegativeInt
    capacity: NonNegativeInt

    @model_validator(mode="after")
    def validate_capacity(self) -> SharedInventoryState:
        if self.spares_available > self.capacity:
            raise ValueError("spares_available cannot exceed capacity")
        return self


class FleetObservation(ContractModel):
    schema_version: Literal["2.0"] = "2.0"
    observation_id: Identifier
    episode_id: Identifier
    step: NonNegativeInt
    machines: list[MachineObservation] = Field(min_length=1)
    inventory: SharedInventoryState

    @model_validator(mode="after")
    def validate_machine_identity(self) -> FleetObservation:
        machine_ids = [machine.machine_id for machine in self.machines]
        tool_ids = [machine.tool_id for machine in self.machines]
        if len(machine_ids) != len(set(machine_ids)):
            raise ValueError("machine_id values must be unique within an observation")
        if len(tool_ids) != len(set(tool_ids)):
            raise ValueError("active tool_id values must be unique within an observation")
        return self


class MachineAction(ContractModel):
    machine_id: Identifier
    action: ToolAction


class JointAction(ContractModel):
    schema_version: Literal["2.0"] = "2.0"
    observation_id: Identifier
    actions: list[MachineAction] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_agents(self) -> JointAction:
        machine_ids = [item.machine_id for item in self.actions]
        if len(machine_ids) != len(set(machine_ids)):
            raise ValueError("a joint action may contain only one action per machine")
        return self


class CostConfig(ContractModel):
    replacement_cost: NonNegativeFloat
    failure_cost: NonNegativeFloat
    waiting_cost_per_step: NonNegativeFloat
    unused_life_cost_per_step: NonNegativeFloat


class RiskConfig(ContractModel):
    objective: RiskObjective
    cvar_alpha: Annotated[float, Field(gt=0.0, lt=1.0)] = 0.95


class EnvironmentConfig(ContractModel):
    schema_version: Literal["2.0"] = "2.0"
    environment_id: Identifier
    number_of_machines: Annotated[int, Field(ge=1)]
    spare_capacity: NonNegativeInt
    initial_spares: NonNegativeInt
    horizon_steps: Annotated[int, Field(ge=1)]
    failure_threshold_um: Annotated[float, Field(gt=0.0)]
    seed: NonNegativeInt
    costs: CostConfig
    risk: RiskConfig

    @model_validator(mode="after")
    def validate_initial_inventory(self) -> EnvironmentConfig:
        if self.initial_spares > self.spare_capacity:
            raise ValueError("initial_spares cannot exceed spare_capacity")
        return self


class PolicyRecommendation(ContractModel):
    schema_version: Literal["2.0"] = "2.0"
    observation_id: Identifier
    policy_id: Identifier
    policy_version: Identifier
    actions: JointAction
    estimated_expected_cost: NonNegativeFloat | None = None
    estimated_cvar_cost: NonNegativeFloat | None = None

    @model_validator(mode="after")
    def validate_observation_reference(self) -> PolicyRecommendation:
        if self.actions.observation_id != self.observation_id:
            raise ValueError("recommendation and joint action must reference the same observation")
        return self


class MachineStepOutcome(ContractModel):
    machine_id: Identifier
    requested_action: ToolAction
    outcome: ExecutionOutcome
    tool_id_before: Identifier
    tool_id_after: Identifier | None = None
    incurred_cost: NonNegativeFloat

    @model_validator(mode="after")
    def validate_tool_transition(self) -> MachineStepOutcome:
        valid_outcomes = {
            ToolAction.CONTINUE: {ExecutionOutcome.CONTINUED, ExecutionOutcome.FAILED},
            ToolAction.REPLACE: {
                ExecutionOutcome.REPLACED,
                ExecutionOutcome.WAITING_FOR_SPARE,
            },
        }
        if self.outcome not in valid_outcomes[self.requested_action]:
            raise ValueError("outcome is incompatible with requested_action")
        if self.outcome is ExecutionOutcome.REPLACED and self.tool_id_after is None:
            raise ValueError("a replacement outcome requires tool_id_after")
        if self.outcome is ExecutionOutcome.REPLACED and self.tool_id_after == self.tool_id_before:
            raise ValueError("a replacement outcome requires a new tool_id_after")
        if self.outcome is not ExecutionOutcome.REPLACED and self.tool_id_after is not None:
            raise ValueError("tool_id_after is only valid for a replacement outcome")
        return self


class StepResult(ContractModel):
    schema_version: Literal["2.0"] = "2.0"
    observation_id: Identifier
    episode_id: Identifier
    step: NonNegativeInt
    outcomes: list[MachineStepOutcome] = Field(min_length=1)
    inventory_after: SharedInventoryState
    total_cost: NonNegativeFloat
    episode_terminated: bool

    @model_validator(mode="after")
    def validate_unique_machine_outcomes(self) -> StepResult:
        machine_ids = [outcome.machine_id for outcome in self.outcomes]
        if len(machine_ids) != len(set(machine_ids)):
            raise ValueError("a step result may contain only one outcome per machine")
        return self


class EpisodeSummary(ContractModel):
    schema_version: Literal["2.0"] = "2.0"
    episode_id: Identifier
    policy_id: Identifier
    seed: NonNegativeInt
    steps_completed: NonNegativeInt
    total_cost: NonNegativeFloat
    failure_count: NonNegativeInt
    replacement_count: NonNegativeInt
    waiting_steps: NonNegativeInt


class CNCContractCatalog(ContractModel):
    """Schema-export catalog. This wrapper is not itself a wire payload."""

    environment_config: EnvironmentConfig
    fleet_observation: FleetObservation
    joint_action: JointAction
    policy_recommendation: PolicyRecommendation
    step_result: StepResult
    episode_summary: EpisodeSummary
