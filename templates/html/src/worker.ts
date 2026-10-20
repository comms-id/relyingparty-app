// The Worker of the plain HTML template: Sign in with Comms.ID routes first, then the static pages.
import { type CommsIdEnv, createCommsIdAuth, durableStore, type RecordsNamespace } from "./comms-id-auth";

export { SessionRecords } from "./session-store";

export interface Env extends CommsIdEnv {
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
  readonly SESSIONS: RecordsNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = createCommsIdAuth({ env, store: durableStore(env.SESSIONS) });
    return (await auth.handle(request)) ?? (await env.ASSETS.fetch(request));
  },
};
