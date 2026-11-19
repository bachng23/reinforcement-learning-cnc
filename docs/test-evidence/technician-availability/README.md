# Technician availability local evidence

- Contracts, typecheck, lint, production build: exit 0.
- Unit/component/API: 64 files, 570 tests passed, maxWorkers=3.
- Edge browser: 13 passed, 1 intentionally skipped mobile WebGL case; 2D mobile and desktop WebGL run.
- Browser evidence is an intercepted HTTP contract harness, not a real Backend/Flex acceptance run.
- Logs are UTF-8 with line-end/whitespace normalization; actual warnings and results are retained.
- No development database/migration/environment or production service was changed.

See [runbook](../../frontend-technician-availability.md) and [verification manifest](../../technician-availability-verification.json).
