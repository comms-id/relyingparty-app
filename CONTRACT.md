# Contract — what relyingparty-app promises its users

Users are relying parties that copy a template, and the agents that build them. Rules are in `NORTHSTAR.md`.

| Promise | Kept by |
|---|---|
| Every push runs `pnpm verify` on the pushed commit | `factory.json` (`verify`), lifecycle CI |
| The governance files a template set needs are present on every commit | `test/governance.test.mjs` |
| Each template signs in with Comms.ID through IdX: one-use pending sign-in, ADR-0068 ID token checks, `__Host-` host-only cookies, same-origin sign-out | `templates/*/test/comms-id-auth.test.ts` |
| The three templates share one sign-in core, byte for byte | `test/templates.test.mjs` |
| A copied template installs from the registry and holds no key, token or loopback address | `test/templates.test.mjs` |
| Each template runs on its own host with its own redirect URI and sector document | `test/templates.test.mjs`, `alchemy.run.ts` |
| Production runs the shipped commit on all four hosts | `scripts/deploy.mjs` (each `/health`), `factory.json` (`prodVerify`) |
