# Saved situations local evidence

- Contracts, typecheck, lint and production build: exit 0.
- 506 unit/component tests passed, 59 files, with maxWorkers=3.
- 6 Edge browser tests passed at 1440×900 and 390×844 with intercepted API responses.
- Empty typecheck stdout is represented by its recorded exit code in the manifest.
- Log files use UTF-8 with whitespace/tab normalization; output text and warnings are preserved.
- Next/Browserslist warnings do not change the recorded exit codes.
- M2 real API/PostgreSQL/Flex acceptance is pending; this is M1 consumer evidence.

See [verification manifest](../../saved-situations-verification.json) and [runbook](../../frontend-saved-situations.md).

Tested frontend implementation: `733855d222ba51fbc89c8d4b2033abefaeba12c2`. The evidence-only follow-up leaves frontend source identical.
