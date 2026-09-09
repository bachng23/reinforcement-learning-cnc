const environmentConfig = {
  schema_version: '2.0', environment_id: 'fixture-environment', number_of_machines: 2,
  spare_capacity: 1, initial_spares: 1, horizon_steps: 2, failure_threshold_um: 300, seed: 7,
  costs: { replacement_cost: 25, failure_cost: 500, waiting_cost_per_step: 7, unused_life_cost_per_step: 1 },
  risk: { objective: 'EXPECTED_COST', cvar_alpha: 0.95 },
};
module.exports = { environmentConfig };
