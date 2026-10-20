/**
 * relyingparty.app (relyingparty-app-69li): Alchemy owns the four Workers, their custom domains on the
 * zone relyingparty.app and their bindings (ADR-0029). Alchemy is the only deploy path.
 *
 *   relyingparty.app          the front page (site/)
 *   html.relyingparty.app     templates/html
 *   react.relyingparty.app    templates/react
 *   nextjs.relyingparty.app   templates/nextjs
 *
 * Each Worker is what its package's build wrote to dist/ (the template's own wrangler.jsonc, bundled by
 * Wrangler's dry run), uploaded as it is. The settings come from that wrangler.jsonc, so a copied template
 * deploys the same Worker with `pnpm run deploy`. Each template is its own IdX client: its own host, its
 * own redirect URI and its own sector document at /oidc/redirect_uris.
 *
 * COMMS_ID_PRIVATE_JWK is a write-only Worker secret that `npx comms-id key --worker <name>` puts. A
 * template inherits it from its newest version only once it has a client id in CLIENT_IDS: before its
 * registration the secret does not exist, and there is nothing to inherit. From then on every deploy
 * must keep the inherit binding, or the secret is dropped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Stack } from "alchemy";
import { DurableObject, providers, state, Worker } from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";

const ZONE_ID = "3005287717b3c87135940af69cd54bbb"; // relyingparty.app

/** The client id Companion gave each template at its registration: public values, set after registration. */
export const CLIENT_IDS: Readonly<Record<string, string>> = {
  Html: "wehudbtv6sdii4qzhxc6owtib7nh48h0",
  React: "p0tvzwo1jj3ksrvjdg3tmfdp9o0iyzra",
  Nextjs: "n2bn90eijyoryyffposuwzt1ivgbwd47",
};

/** The commit /health names, which ship's production check expects. */
const COMMIT_SHA = process.env.COMMIT_SHA?.trim() || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

interface WranglerConfig {
  readonly name: string;
  readonly compatibility_date: string;
  readonly compatibility_flags?: string[];
  readonly assets: {
    readonly directory: string;
    readonly run_worker_first?: string[];
    readonly not_found_handling?: "none" | "404-page" | "single-page-application";
  };
  readonly durable_objects?: { readonly bindings: { readonly name: string; readonly class_name: string }[] };
  readonly vars?: Record<string, string>;
}

/** Every Worker of the stack: its package directory, its host and where its build wrote the bundle. */
export const WORKERS = [
  { id: "Site", dir: "site", host: "relyingparty.app", bundle: "dist/worker.js" },
  { id: "Html", dir: "templates/html", host: "html.relyingparty.app", bundle: "dist/worker.js" },
  { id: "React", dir: "templates/react", host: "react.relyingparty.app", bundle: "dist/worker/worker.js" },
  { id: "Nextjs", dir: "templates/nextjs", host: "nextjs.relyingparty.app", bundle: "dist/worker.js" },
] as const;

const root = new URL("./", import.meta.url);
const path = (relative: string) => fileURLToPath(new URL(relative, root));

/** wrangler.jsonc: JSON with whole-line // comments. */
const readConfig = (dir: string): WranglerConfig =>
  JSON.parse(
    readFileSync(path(`${dir}/wrangler.jsonc`), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
  );

export default Stack(
  "relyingparty-app",
  { providers: providers(), state: state() },
  Effect.gen(function* () {
    const urls: Record<string, string | undefined> = {};
    for (const entry of WORKERS) {
      const config = readConfig(entry.dir);
      const clientId = CLIENT_IDS[entry.id];
      const template = entry.dir.startsWith("templates/");
      const worker = yield* Worker(entry.id, {
        name: config.name,
        main: path(`${entry.dir}/${entry.bundle}`),
        bundle: false,
        compatibility: { date: config.compatibility_date, flags: config.compatibility_flags ?? [] },
        assets: {
          directory: path(`${entry.dir}/${config.assets.directory}`),
          runWorkerFirst: config.assets.run_worker_first ?? false,
          notFoundHandling: config.assets.not_found_handling ?? "none",
        },
        domain: { name: entry.host, zoneId: ZONE_ID },
        workersDev: { enabled: false },
        crons: [],
        logpush: false,
        // Off: the templates keep nothing but the session (front page, "What these templates keep").
        observability: { enabled: false },
        env: {
          ...config.vars,
          COMMIT_SHA,
          ...(template
            ? {
                COMMS_ID_REDIRECT_URI: `https://${entry.host}/auth/callback`,
                COMMS_ID_CLIENT_ID: clientId ?? "",
              }
            : {}),
          ...Object.fromEntries(
            (config.durable_objects?.bindings ?? []).map((binding) => [
              binding.name,
              DurableObject(binding.name, { className: binding.class_name }),
            ])
          ),
        },
      }).pipe(retain());
      if (template && clientId !== undefined) {
        yield* worker.bind`InheritedSecrets`({
          bindings: [{ type: "inherit", name: "COMMS_ID_PRIVATE_JWK", versionId: "latest" }],
        });
      }
      urls[entry.id] = `https://${entry.host}`;
    }
    return urls;
  })
);
