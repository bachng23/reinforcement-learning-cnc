# CNC Domain Contract v2

This directory is the language-neutral contract boundary for the CNC tool replacement research system. The canonical models are implemented with Pydantic in `ai_services/domain/cnc/contracts.py`; `cnc-domain.schema.json` is the generated artifact for backend and frontend consumers.

## Research invariants

The v2 contract encodes the following study decisions:

1. A policy action is exactly `CONTINUE` or `REPLACE`.
2. `WAITING_FOR_SPARE` is an environment outcome, not a policy action.
3. RUL is passed as a discrete probability distribution over simulator steps, not collapsed to one point estimate.
4. Shared spare inventory is part of every fleet observation.
5. Failure threshold, cost coefficients, risk objective, CVaR level, horizon, and seed belong to environment configuration.
6. Policy observations contain measured wear and posterior belief summaries. Simulator ground truth such as `latent_wear_um`, change point, adhesion state, and sampled degradation rate is private.
7. Time is measured in `step` until a defensible physical-time mapping exists.

## Wire conventions

- JSON fields use `snake_case`.
- Contract models reject unknown fields.
- Probabilities are numbers in `[0, 1]`.
- Costs are non-negative scalar values in one experiment-configured currency unit.
- Floating-point fields reject non-finite values such as `NaN` and infinity.
- Wear is expressed in micrometres with the `_um` suffix.
- Step counts use the `_steps` suffix.
- Identifiers and display labels are separate concerns; identifiers are stable machine-readable strings.
- Every top-level wire payload carries `schema_version: "2.0"`.

## Contract catalog

| Model | Purpose |
| --- | --- |
| `EnvironmentConfig` | Scenario-owned failure, inventory, cost, risk, horizon, and seed settings |
| `FleetObservation` | Observable state supplied to a policy at one step |
| `RULDistribution` | Full discrete RUL probability mass plus probability beyond the represented horizon |
| `JointAction` | One binary tool decision per participating machine |
| `PolicyRecommendation` | Versioned policy output and optional cost estimates |
| `StepResult` | Executed outcomes, costs, and inventory after one environment step |
| `EpisodeSummary` | Reproducible per-seed result used by later evaluation code |

`spare_capacity: 0` is valid so experiments can include a no-spares baseline.

## M4 boundary

M4-Compact may expose latent arrays to simulator diagnostics, but the environment adapter must construct `FleetObservation` without forwarding them. The following remain simulator-private:

- `latent_wear_um`
- `adhesion_um` and `adhesion_state`
- `mean_rates_um_per_step`
- `change_point_step`
- stage diagnostics

The environment derives the RUL distribution by applying its configured failure threshold to Monte Carlo futures. M4 itself does not own the threshold, action semantics, cost model, or CVaR objective.

## Generate and verify

From `ai_services`:

```bash
uv run python scripts/export_cnc_contracts.py
uv run pytest tests/test_cnc_contracts.py -q
```

Do not edit `cnc-domain.schema.json` manually. Change the Pydantic models, regenerate, and run the contract tests.
