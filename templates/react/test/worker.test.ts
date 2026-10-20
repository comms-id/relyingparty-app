// The Worker entry: the sign-in routes run before the React app, and the rest is the pages'.
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";

const env = (assets: string[]): Env => ({
  ASSETS: {
    fetch: async (request) => {
      assets.push(new URL(request.url).pathname);
      return new Response("page");
    },
  },
  SESSIONS: {
    getByName: () => ({
      get: async () => undefined,
      put: async () => {},
      take: async () => undefined,
      delete: async () => {},
    }),
  },
  COMMS_ID_REDIRECT_URI: "https://react.relyingparty.app/auth/callback",
  COMMIT_SHA: "abc",
});

describe("the Worker", () => {
  it("answers the sign-in routes itself", async () => {
    const assets: string[] = [];
    const response = await worker.fetch(new Request("https://react.relyingparty.app/oidc/redirect_uris"), env(assets));
    expect(await response.json()).toEqual(["https://react.relyingparty.app/auth/callback"]);
    expect(assets).toEqual([]);
  });

  it("answers 503 at /auth/sign-in until the app is registered", async () => {
    const response = await worker.fetch(new Request("https://react.relyingparty.app/auth/sign-in"), env([]));
    expect(response.status).toBe(503);
  });

  it("leaves the pages to the React app", async () => {
    const assets: string[] = [];
    const response = await worker.fetch(new Request("https://react.relyingparty.app/"), env(assets));
    expect(await response.text()).toBe("page");
    expect(assets).toEqual(["/"]);
  });
});
