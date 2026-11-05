"""RFC8785 hashing is distinct from the Backend's frozen receipt identity."""
import hashlib
from datetime import datetime, timezone

import rfc8785


def content_hash(value) -> str:
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def normalized(value):
    if isinstance(value, datetime):
        if value.microsecond % 1000:
            raise ValueError("timestamp exceeds millisecond precision")
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: normalized(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalized(item) for item in value]
    return value
