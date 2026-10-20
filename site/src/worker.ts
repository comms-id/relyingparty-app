// relyingparty.app: the front page is static; the Worker answers only /health with the commit it runs.
export interface Env {
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
  readonly COMMIT_SHA?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      return new Response(`commit ${env.COMMIT_SHA?.trim() || "unknown"}\n`, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return await env.ASSETS.fetch(request);
  },
};
