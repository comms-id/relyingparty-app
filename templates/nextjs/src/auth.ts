// Sign in with Comms.ID in this Next.js app: the shared core with this Worker's settings and its
// Durable Object store (wrangler.jsonc), read through OpenNext's Cloudflare context.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type CommsIdAuth, type CommsIdEnv, createCommsIdAuth, durableStore, type RecordsNamespace } from "./comms-id-auth";

export interface Env extends CommsIdEnv {
  readonly SESSIONS: RecordsNamespace;
}

export const commsIdAuth = (): CommsIdAuth => {
  const env = getCloudflareContext().env as unknown as Env;
  return createCommsIdAuth({ env, store: durableStore(env.SESSIONS) });
};

/** The class this app signs people in with: its button asks for it. */
export const signInClass = (): "person" | "team" =>
  (getCloudflareContext().env as unknown as Env).COMMS_ID_SIGN_IN_CLASS === "team" ? "team" : "person";

/** A route handler for the core's routes. */
export const handle = async (request: Request): Promise<Response> =>
  (await commsIdAuth().handle(request)) ?? new Response("Not Found\n", { status: 404 });
