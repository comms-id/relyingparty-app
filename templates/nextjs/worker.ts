// The Worker: OpenNext's Next.js handler, and the Durable Object class the sessions live in.
// @ts-ignore: .open-next/worker.js is written by `opennextjs-cloudflare build`.
import handler from "./.open-next/worker.js";

export { SessionRecords } from "./src/session-store";

export default {
  fetch: handler.fetch,
};
