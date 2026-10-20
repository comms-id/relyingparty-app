# North Star — relyingparty-app

Rank: the owner's dated, quoted decisions, then this file, then `decisions/`, then `CONTRACT.md`, then code. `AGENTS.md` only routes. What is met today is never written here: `lifecycle adoption relyingparty-app` is the live status.

## Mission

A relying party adopts Comms.ID sign-in by copying a template from relyingparty.app that works the first time, and each template shows the safe way to use Comms.ID's own products (identity verification, browser signals, PAD liveness).

## What must stay true

1. **Templates work as copied.** Every template passes `pnpm verify` on every push; a template that does not run is not published.
2. **Comms.ID's own products only.** No template offers Turnstile, CAPTCHAs, email or SMS codes, magic links or passkeys in place of Comms.ID sign-in.
3. **Nothing secret in a template.** A template names the settings a relying party supplies; it never holds a key, a token or personal information.
4. **One source.** Code lives in the Artifacts repo `comms-id/relyingparty-app`; the GitHub copy is a mirror, overwritten on every push.

## When principles conflict

Safety of the relying party's users, then correctness of the template, then ease of copying, then breadth of templates.

## What is not the goal

- a hosted product that relying parties depend on at run time
- templates for sign-in methods other than Comms.ID's own
- examples that only work on one machine

## How to test a change

1. Does every template still pass `pnpm verify`?
2. Does it use only Comms.ID's own sign-in products?
3. Is every value a relying party must supply named, and none stored here?
