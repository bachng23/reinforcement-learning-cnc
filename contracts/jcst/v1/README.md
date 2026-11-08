# JCST research wire contract v1

Canonical models: `ai_services/domain/jcst/contracts.py`. Generate with
`ai_services/.venv/bin/python ai_services/scripts/export_jcst_contracts.py` and
`npm --prefix frontend run contracts:jcst:generate`; check drift with
`ai_services/.venv/bin/python scripts/check-jcst-contracts.py`.

- `wire_schema_version=jcst-research/1.0` is independent of physical `JCST/1.1`.
- Complete matchings are lists of machine/component/technician triples; `[]` is WAIT.
- Time is ticks. Costs are simulation units. No calendar-minute conversion is implied.
- Seeds are decimal strings, including values exceeding JS safe integer and uint64.
- Entity ordering is the original zero-based simulator order; display labels add one.
- Artifact content is original UTF-8 text with SHA-256. Analysis projections must
  exactly match the retained projection artifact and link original source artifacts.
- A bundle has at most 12 complete traces and 2,000 curve rows, with an 8 MB API
  input cap. Large campaigns use bounded documentary subsets and original summary
  artifacts. Their coverage remains explicit.
- Physical replay validates state/action/catalogue/event/noise/cost identity on
  included traces. Source statistical PASS remains a source-reported assertion.
- New family/version, unknown fields, malformed dimensions, illegal matching,
  mismatched H/tail or modified bytes fail visibly.

The committed `fixtures/engineering-bundle.json` is an engineering integration
fixture, not scientific performance evidence. No scientific raw data/checkpoint
is bundled in Git. The Research OpenAPI is `backend/research-openapi.yaml`, served
at `/api/v1/research/openapi.yaml` after authentication.
