// Ship (factory.json "ship"): build every Worker, deploy the Alchemy stack (alchemy.run.ts), then wait
// until each of the four hosts answers /health with this commit.
//
// Lifecycle gives the deploy token as CLOUDFLARE_DEPLOY_TOKEN (factory.json shipSecrets); Alchemy reads
// CLOUDFLARE_API_TOKEN, so it is passed on under that name, as platform's ship does.
import { execFileSync, spawnSync } from "node:child_process";

const REFUSED = "REFUSED by the relyingparty-app ship step (relyingparty-app-69li)";
const HOSTS = ["relyingparty.app", "html.relyingparty.app", "react.relyingparty.app", "nextjs.relyingparty.app"];
const WAIT_MS = 180_000;

const token = process.env.CLOUDFLARE_DEPLOY_TOKEN?.trim();
if (!token) {
  console.error(
    `${REFUSED}: CLOUDFLARE_DEPLOY_TOKEN is not set.\n` +
      "Lifecycle gives it from SHIP_RELYINGPARTY_APP_CLOUDFLARE_DEPLOY_TOKEN (factory.json shipSecrets); " +
      "for a local run, load it with /Users/MN/bin/comms-id-secret."
  );
  process.exit(1);
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, COMMIT_SHA: commit };

const run = (command, args) => {
  console.log(`ship: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) {
    console.error(`${REFUSED}: ${command} ${args.join(" ")} exited with ${result.status ?? result.signal}.`);
    process.exit(1);
  }
};

run("pnpm", ["--filter", "./site", "--filter", "./templates/html", "--filter", "./templates/react", "run", "build"]);
run("pnpm", ["--filter", "./templates/nextjs", "run", "build:worker"]);
run("pnpm", ["exec", "alchemy", "deploy", "--stage", "production", "--yes"]);

const expected = `commit ${commit}`;
const deadline = Date.now() + WAIT_MS;
for (const host of HOSTS) {
  let last = "";
  for (;;) {
    try {
      const response = await fetch(`https://${host}/health`, { cache: "no-store" });
      last = `${response.status} ${(await response.text()).trim()}`;
      if (response.ok && last.endsWith(expected)) {
        console.log(`ship: https://${host}/health names ${commit.slice(0, 12)}`);
        break;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) {
      console.error(`${REFUSED}: https://${host}/health does not name ${commit} (last answer: ${last}).`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
