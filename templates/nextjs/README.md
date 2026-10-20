# Sign in with Comms.ID: Next.js template

Next.js on Cloudflare Workers ([OpenNext](https://opennext.js.org/cloudflare)). Route handlers run the sign-in at IdX with [`@comms-id/sign-in`](https://comms.id/docs/reference/sign-in), and the page reads the session on the server. Live at <https://nextjs.relyingparty.app>.

The browser holds only a session cookie. The signing key, the pending sign-in and the session stay on the Worker.

## Copy it

```sh
npx degit comms-id/relyingparty-app/templates/nextjs my-app
cd my-app
pnpm install
```

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

- `src/comms-id-auth.ts` holds all of it, the same file as in the other templates. The route handlers in `app/` hand their request to it (`src/auth.ts`).
- `app/page.tsx` is a Server Component: it reads the session from the request's cookie. `app/sign-in-button.tsx` makes `SignInButton` a client module, because `@comms-id/sign-in-react` 0.1.0 does not mark it `"use client"`.
- `worker.ts` is OpenNext's handler plus the `SessionRecords` Durable Object class, which the Worker must export.
- `proxy.ts` gives each page a fresh nonce in a strict Content-Security-Policy; Next.js puts it on its own scripts. Inline style attributes are allowed, because `SignInButton` sets one.

The session lasts as long as the ID token (1 hour). When a page is rendered after the token expired, it renews the session silently (`prompt=none`), up to 10 minutes after expiry; then the session is deleted. Sign-out ends this app's session only: IdX has no end-session endpoint.

## Run it

- `pnpm preview`: the built Worker in the local Workers runtime, with the Durable Object. Use it to try the whole flow.
- `pnpm dev`: `next dev` for the pages. It reads the settings in `wrangler.jsonc`, but cannot host the Durable Object, so sessions do not work there.

A sign-in completes only on the registered redirect URI, which is an https host.

## Tests

```sh
pnpm verify   # typecheck, tests, and the OpenNext Worker build
```

The tests run in Node against the fake issuer of `@comms-id/sign-in` (no network): cookies, `return_to`, the class, the ID token checks of ADR-0068, replay, renewal, sign-out, and the route handlers. The ML-DSA-87 path in the Workers runtime is proven by a live sign-in on <https://nextjs.relyingparty.app>.

`pnpm build` is `next build`: OpenNext runs it from `opennextjs-cloudflare build`, so it must not run OpenNext itself. `pnpm build:worker` builds the Worker.

## Known limits

- OpenNext runs `proxy.ts` as Node.js middleware, which it marks experimental on Cloudflare. The nonce is proven on the built Worker; if a later OpenNext changes this, the page's scripts stop running and the browser console names the blocked scripts.
