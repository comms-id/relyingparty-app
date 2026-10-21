# Sign in with Comms.ID: plain HTML template

A static page with the `<comms-id-sign-in>` element, and a small Cloudflare Worker that runs the sign-in at IdX with [`@comms-id/sign-in`](https://comms.id/docs/reference/sign-in). Live at <https://html.relyingparty.app>.

The browser holds only a session cookie. The signing key, the pending sign-in and the session stay on the Worker.

## Copy it

```sh
npx degit comms-id/relyingparty-app/templates/html my-app
cd my-app
pnpm install
```

If your npm config maps `@comms-id` to another registry, add `registries: { '@comms-id': https://registry.npmjs.org/ }` to your `pnpm-workspace.yaml`: the packages are on npmjs.

The template's `pnpm-workspace.yaml` approves the build scripts of `esbuild` and `workerd`. When a `@comms-id` version is only hours old, pnpm's minimum release age applies: pnpm records the version under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` itself, or, with `minimumReleaseAgeStrict: true`, stops with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`; then add the version it names to `minimumReleaseAgeExclude`.

## Settings

| Setting | Where | Value |
|---|---|---|
| `name` | `wrangler.jsonc` | your Worker's name |
| `COMMS_ID_ISSUER` | `wrangler.jsonc` vars | `https://exchange.comms.id` |
| `COMMS_ID_REDIRECT_URI` | `wrangler.jsonc` vars | `https://<your host>/auth/callback` |
| `COMMS_ID_SIGN_IN_CLASS` | `wrangler.jsonc` vars | `person` (the default) or `team` |
| `COMMS_ID_CLIENT_ID` | `wrangler.jsonc` vars | the client id Companion gives you |
| `COMMS_ID_PRIVATE_JWK` | Worker secret | written by `npx comms-id key`; never in a file |

## Make it yours

1. Set `name` and `COMMS_ID_REDIRECT_URI` in `wrangler.jsonc`, and add your host as a custom domain.
2. Deploy once: `pnpm run deploy`. The page and the sector document are live; `/auth/sign-in` answers 503 and names the settings that are missing.
3. Make the signing key: `npx comms-id key --worker <your Worker>`. It writes the ML-DSA-87 private key into the Worker secret `COMMS_ID_PRIVATE_JWK` and prints the public key with its `kid`.
4. Register the app in Companion: the public key in its `jwks`, the redirect URI, the sector document `https://<your host>/oidc/redirect_uris` and the sign-in class (`sign_in_classes_accepted`).
5. Set `COMMS_ID_CLIENT_ID` to the client id Companion gives you, and deploy again.

To change the class, change both the registration in Companion and `COMMS_ID_SIGN_IN_CLASS`, then deploy. A registration that accepts both `person` and `team` is not supported: the flow handles one class (platform ADR-0068 decision 10a).

## How it works

| Route | What it does |
|---|---|
| `GET /auth/sign-in?return_to=` | Starts a sign-in (PAR, PKCE, `private_key_jwt`); keeps the pending sign-in in a Durable Object named by the `__Host-rp-pending` cookie |
| `GET /auth/callback` | Uses the pending sign-in once, verifies the ML-DSA-87 ID token, starts the session (`__Host-rp-session`) |
| `GET /auth/renew?return_to=` | A silent sign-in (`prompt=none`) |
| `POST /auth/sign-out` | Ends this app's session; only a form on this app's own origin can post it |
| `GET /api/me` | The signed-in profile, or 401 |
| `GET /oidc/redirect_uris` | This app's sector document: its one redirect URI |
| `GET /health` | `commit <sha>` |

`src/comms-id-auth.ts` holds all of it; `src/worker.ts` hands it every request first and serves the page for the rest. The cookies are `__Host-` cookies (HttpOnly, Secure, SameSite=Lax, no Domain), so the session stays on this host.

The session lasts as long as the ID token (1 hour). The page renews it silently from 5 minutes before the token expires, and up to 10 minutes after; then the session is deleted. Sign-out ends this app's session only: IdX has no end-session endpoint.

`public/_headers` sets a strict Content-Security-Policy. The element is pinned to one version with its integrity hash.

## Tests

```sh
pnpm verify   # typecheck, tests, and the Worker build
```

The tests run in Node against the fake issuer of `@comms-id/sign-in` (no network): cookies, `return_to`, the class, the ID token checks of ADR-0068, replay, renewal and sign-out. The ML-DSA-87 path in the Workers runtime is proven by a live sign-in on <https://html.relyingparty.app>.
