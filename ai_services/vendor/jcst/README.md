# Immutable upstream source bundle

`manifest.json` records the repository, exact commit, original paths and SHA-256
of each source file. The four `ht_pdm_fjsp` modules and independent replay auditor
are unchanged source bytes from the user's research repository. The empty
`__init__.py` only establishes the package. Do not modify physics/controllers or
learner code here; update the whole pinned bundle and rerun parity checks when
adopting a new version. Application adapters live in `domain/jcst`.

Importing the bridge performs no training, checkpoint loading, scientific
evaluation or data collection. Learned weights are registered separately and
loaded only by an explicit inference job or bounded test.
