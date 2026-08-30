import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.cnc.contracts import (
    CostConfig,
    CuttingCondition,
    EnvironmentConfig,
    ExecutionOutcome,
    FleetObservation,
    JointAction,
    MachineAction,
    MachineObservation,
    MachineStepOutcome,
    PolicyRecommendation,
    RULDistribution,
    RiskConfig,
    RiskObjective,
    SharedInventoryState,
    StepResult,
    ToolAction,
    ToolBeliefState,
)
from domain.cnc.schema import build_contract_schema


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "contracts" / "v2" / "cnc-domain.schema.json"


def make_rul_distribution() -> RULDistribution:
    return RULDistribution(
        support_steps=[0, 1, 2, 3],
        probability_mass=[0.05, 0.15, 0.30, 0.20],
        survival_beyond_horizon=0.30,
        model_version="m4-compact-v0.1",
    )


def make_machine(machine_id: str = "machine-01", tool_id: str = "tool-01") -> MachineObservation:
    return MachineObservation(
        machine_id=machine_id,
        tool_id=tool_id,
        job_id="job-01",
        cutting_condition=CuttingCondition(condition_id="nominal", load_class="NOMINAL"),
        tool_state=ToolBeliefState(
            tool_age_steps=12,
            observed_wear_um=145.0,
            posterior_median_wear_um=138.0,
            posterior_std_wear_um=11.5,
            rul_distribution=make_rul_distribution(),
        ),
    )


def test_valid_research_contracts() -> None:
    observation = FleetObservation(
        observation_id="obs-001",
        episode_id="episode-001",
        step=12,
        machines=[make_machine()],
        inventory=SharedInventoryState(spares_available=2, capacity=3),
    )
    actions = JointAction(
        observation_id=observation.observation_id,
        actions=[MachineAction(machine_id="machine-01", action=ToolAction.REPLACE)],
    )
    recommendation = PolicyRecommendation(
        observation_id=observation.observation_id,
        policy_id="threshold-uncertainty",
        policy_version="1.0.0",
        actions=actions,
        estimated_expected_cost=120.0,
        estimated_cvar_cost=450.0,
    )
    config = EnvironmentConfig(
        environment_id="cnc-fleet-v0.1",
        number_of_machines=4,
        spare_capacity=3,
        initial_spares=2,
        horizon_steps=480,
        failure_threshold_um=300.0,
        seed=42,
        costs=CostConfig(
            replacement_cost=100.0,
            failure_cost=5000.0,
            waiting_cost_per_step=20.0,
            unused_life_cost_per_step=2.0,
        ),
        risk=RiskConfig(objective=RiskObjective.CVAR, cvar_alpha=0.95),
    )

    assert recommendation.actions.actions[0].action is ToolAction.REPLACE
    assert config.initial_spares == observation.inventory.spares_available


@pytest.mark.parametrize(
    "changes",
    [
        {"probability_mass": [0.2, 0.3]},
        {"support_steps": [1, 2, 3, 4]},
        {"support_steps": [0, 2, 1, 3]},
        {"survival_beyond_horizon": 0.4},
    ],
)
def test_rul_distribution_rejects_invalid_probability_contract(changes: dict) -> None:
    payload = make_rul_distribution().model_dump()
    payload.update(changes)
    with pytest.raises(ValidationError):
        RULDistribution.model_validate(payload)


def test_policy_observation_forbids_simulator_latent_state() -> None:
    payload = make_machine().tool_state.model_dump()
    payload["latent_wear_um"] = 151.0
    with pytest.raises(ValidationError, match="latent_wear_um"):
        ToolBeliefState.model_validate(payload)


@pytest.mark.parametrize("unsupported_action", ["WAIT", "PAUSE", "REPAIR", "SHUTDOWN"])
def test_policy_action_is_binary(unsupported_action: str) -> None:
    with pytest.raises(ValidationError):
        MachineAction(machine_id="machine-01", action=unsupported_action)


def test_waiting_for_spare_is_an_outcome() -> None:
    result = MachineStepOutcome(
        machine_id="machine-01",
        requested_action=ToolAction.REPLACE,
        outcome=ExecutionOutcome.WAITING_FOR_SPARE,
        tool_id_before="tool-01",
        incurred_cost=20.0,
    )
    assert result.outcome is ExecutionOutcome.WAITING_FOR_SPARE


def test_inventory_and_machine_identity_invariants() -> None:
    with pytest.raises(ValidationError):
        SharedInventoryState(spares_available=4, capacity=3)

    with pytest.raises(ValidationError, match="machine_id"):
        FleetObservation(
            observation_id="obs-001",
            episode_id="episode-001",
            step=0,
            machines=[make_machine(), make_machine(tool_id="tool-02")],
            inventory=SharedInventoryState(spares_available=2, capacity=3),
        )


def test_zero_spare_capacity_is_a_valid_experiment_scenario() -> None:
    inventory = SharedInventoryState(spares_available=0, capacity=0)
    config = EnvironmentConfig(
        environment_id="no-spares-baseline",
        number_of_machines=2,
        spare_capacity=0,
        initial_spares=0,
        horizon_steps=100,
        failure_threshold_um=300.0,
        seed=42,
        costs=CostConfig(
            replacement_cost=100.0,
            failure_cost=5000.0,
            waiting_cost_per_step=20.0,
            unused_life_cost_per_step=2.0,
        ),
        risk=RiskConfig(objective=RiskObjective.EXPECTED_COST),
    )

    assert inventory.capacity == config.spare_capacity == 0


@pytest.mark.parametrize(
    ("requested_action", "outcome"),
    [
        (ToolAction.CONTINUE, ExecutionOutcome.REPLACED),
        (ToolAction.CONTINUE, ExecutionOutcome.WAITING_FOR_SPARE),
        (ToolAction.REPLACE, ExecutionOutcome.CONTINUED),
        (ToolAction.REPLACE, ExecutionOutcome.FAILED),
    ],
)
def test_step_outcome_must_match_requested_action(
    requested_action: ToolAction,
    outcome: ExecutionOutcome,
) -> None:
    with pytest.raises(ValidationError, match="incompatible"):
        MachineStepOutcome(
            machine_id="machine-01",
            requested_action=requested_action,
            outcome=outcome,
            tool_id_before="tool-01",
            incurred_cost=20.0,
        )


def test_step_result_has_one_outcome_per_machine() -> None:
    outcome = MachineStepOutcome(
        machine_id="machine-01",
        requested_action=ToolAction.CONTINUE,
        outcome=ExecutionOutcome.CONTINUED,
        tool_id_before="tool-01",
        incurred_cost=0.0,
    )
    with pytest.raises(ValidationError, match="one outcome per machine"):
        StepResult(
            observation_id="obs-001",
            episode_id="episode-001",
            step=1,
            outcomes=[outcome, outcome],
            inventory_after=SharedInventoryState(spares_available=0, capacity=0),
            total_cost=0.0,
            episode_terminated=False,
        )


@pytest.mark.parametrize("invalid_cost", [float("nan"), float("inf")])
def test_contracts_reject_non_finite_numbers(invalid_cost: float) -> None:
    with pytest.raises(ValidationError):
        CostConfig(
            replacement_cost=invalid_cost,
            failure_cost=5000.0,
            waiting_cost_per_step=20.0,
            unused_life_cost_per_step=2.0,
        )


def test_recommendation_references_one_observation() -> None:
    actions = JointAction(
        observation_id="obs-001",
        actions=[MachineAction(machine_id="machine-01", action=ToolAction.CONTINUE)],
    )
    with pytest.raises(ValidationError, match="same observation"):
        PolicyRecommendation(
            observation_id="obs-002",
            policy_id="fixed-schedule",
            policy_version="1.0.0",
            actions=actions,
        )


def test_exported_schema_is_current_and_domain_clean() -> None:
    exported = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    expected = build_contract_schema()

    assert exported == expected
    serialized = json.dumps(exported)
    assert "latent_wear_um" not in serialized.lower()
