"""Common random numbers for Scenario only; legacy LIVE sampler is unchanged."""
import hashlib

import rfc8785

from domain.scenarios.contracts import SAMPLING_VERSION, SamplingSpec
from domain.scenarios.hashing import content_hash, normalized


class CommonRandomDraws:
    def __init__(self, snapshot, specification: SamplingSpec):
        self.specification = specification
        self.observations = {
            health.health_snapshot_id: [health.health_snapshot_id, health.machine_id, normalized(health.observed_at)]
            for health in snapshot.health_snapshots
        }
        self._cache = {}
        self.observation_hash = content_hash(sorted(self.observations.values()))
        self.coupling_key = content_hash([SAMPLING_VERSION, specification.base_seed, self.observation_hash])

    def __call__(self, observation, draw_index):
        if type(draw_index) is not int or not 0 <= draw_index < self.specification.sample_count:
            raise ValueError("draw index is outside the frozen sampling specification")
        identity = [observation.health_snapshot_id, observation.machine_id, normalized(observation.observed_at)]
        if self.observations.get(observation.health_snapshot_id) != identity:
            raise ValueError("sampling observation is not from the pinned baseline")
        key = observation.health_snapshot_id, draw_index
        if key not in self._cache:
            payload = [SAMPLING_VERSION, self.specification.base_seed, *identity, draw_index]
            digest = hashlib.sha256(rfc8785.dumps(payload)).digest()
            self._cache[key] = (int.from_bytes(digest[:8], "big") >> 11) / 2**53
        return self._cache[key]

    def metadata(self):
        return {**self.specification.model_dump(), "algorithm": "sha256-first53-uniform:1",
                "observation_set_hash": self.observation_hash, "coupling_key": self.coupling_key}
