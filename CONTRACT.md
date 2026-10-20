# Contract — what relyingparty-app promises its users

Users are relying parties that copy a template, and the agents that build them. Rules are in `NORTHSTAR.md`.

| Promise | Kept by |
|---|---|
| Every push runs `pnpm verify` on the pushed commit | `factory.json` (`verify`), lifecycle CI |
| The governance files a template set needs are present on every commit | `test/governance.test.mjs` |
