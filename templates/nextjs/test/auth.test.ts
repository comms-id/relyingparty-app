// The Next.js adapter: the route handlers reach the shared core with the Worker's settings and store.
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  SESSIONS: {
    getByName: () => ({
      get: async () => undefined,
      put: async () => {},
      take: async () => undefined,
      delete: async () => {},
    }),
  },
  COMMS_ID_REDIRECT_URI: "https://nextjs.relyingparty.app/auth/callback",
  COMMS_ID_SIGN_IN_CLASS: "person",
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env }) }));

const { handle, signInClass } = await import("../src/auth");

describe("the Next.js adapter", () => {
  it("answers 503 at /auth/sign-in until the app is registered", async () => {
    const response = await handle(new Request("https://nextjs.relyingparty.app/auth/sign-in"));
    expect(response.status).toBe(503);
  });

  it("answers /api/me with 401 for a browser with no session", async () => {
    const response = await handle(new Request("https://nextjs.relyingparty.app/api/me"));
    expect(response.status).toBe(401);
  });

  it("serves the sector document", async () => {
    const response = await handle(new Request("https://nextjs.relyingparty.app/oidc/redirect_uris"));
    expect(await response.json()).toEqual(["https://nextjs.relyingparty.app/auth/callback"]);
  });

  it("answers 404 for a path that is not the core's", async () => {
    expect((await handle(new Request("https://nextjs.relyingparty.app/auth/other"))).status).toBe(404);
  });

  it("asks the button for the configured class", () => {
    expect(signInClass()).toBe("person");
    env.COMMS_ID_SIGN_IN_CLASS = "team";
    expect(signInClass()).toBe("team");
  });
});
