"""Additive typed LIVE bounds. Never changes the persisted source or telemetry."""
from domain.operations.contracts import FactorySnapshot


def with_start_constraints(snapshot: FactorySnapshot, constraints) -> FactorySnapshot:
    raw = snapshot.model_dump()
    for bound in constraints:
        target = next((item for item in raw['maintenance_requests'] if item['maintenance_request_id'] == bound.maintenance_request_id), None)
        if target is None or target['status'].value in {'COMPLETED', 'CANCELLED'}:
            raise ValueError('Maintenance start constraint target is absent or terminal')
        if not max(snapshot.planning_window.start_at, target['earliest_start_at']) <= bound.earliest_start_at < snapshot.planning_window.end_at:
            raise ValueError('Maintenance start constraint cannot relax its lower bound or exceed the window')
        target['earliest_start_at'] = bound.earliest_start_at
    # Canonical model rejects lower > latest; never widen a hard upper bound.
    return FactorySnapshot.model_validate(raw)
