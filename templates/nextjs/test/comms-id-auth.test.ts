// The sign-in routes against the fake issuer of @comms-id/sign-in: no network, no Worker runtime.
// The same file in every relyingparty.app template.
import { createFakeIssuer, type AuthorizeOptions } from "@comms-id/sign-in/fake-issuer";
import { describe, expect, it } from "vitest";
import { type CommsIdEnv, createCommsIdAuth, PENDING_COOKIE, type RecordStore, SESSION_COOKIE } from "../src/comms-id-auth";

const ORIGIN = "https://template.relyingparty.app";
const HOUR = 3_600_000;
const MINUTE = 60_000;

const memoryStore = (now: () => number) => {
  const records = new Map<string, { value: unknown; deleteAt: number }>();
  const get = async (name: string) => {
    const record = records.get(name);
    return record === undefined || record.deleteAt <= now() ? undefined : structuredClone(record.value);
  };
  const store: RecordStore = {
    get,
    put: async (name, value, deleteAt) => {
      records.set(name, { value: structuredClone(value), deleteAt });
    },
    take: async (name) => {
      const value = await get(name);
      records.delete(name);
      return value;
    },
    delete: async (name) => {
      records.delete(name);
    },
  };
  return { store, records };
};

/** A browser on ORIGIN: it keeps the cookies the app sets and sends them back. */
const setup = async (options: { signInClass?: "person" | "team"; env?: Partial<CommsIdEnv> } = {}) => {
  const clock = { now: Date.now() };
  const now = () => clock.now;
  const issuer = await createFakeIssuer({ now });
  const client = await issuer.registerClient({ redirectUri: `${ORIGIN}/auth/callback` });
  const { store, records } = memoryStore(now);
  const env: CommsIdEnv = {
    COMMS_ID_ISSUER: issuer.issuer,
    COMMS_ID_CLIENT_ID: client.clientId,
    COMMS_ID_REDIRECT_URI: client.redirectUri,
    COMMS_ID_PRIVATE_JWK: JSON.stringify({ ...client.privateJwk, kid: client.kid }),
    COMMS_ID_SIGN_IN_CLASS: options.signInClass ?? "person",
    COMMIT_SHA: "0123abc",
    ...options.env,
  };
  const auth = createCommsIdAuth({ env, store, fetch: issuer.fetch, now });
  const jar = new Map<string, string>();

  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (jar.size > 0) {
      headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    const response = await auth.handle(new Request(new URL(path, ORIGIN), { ...init, headers }));
    if (response === undefined) {
      throw new Error(`no route for ${path}`);
    }
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const [name = "", value = ""] = pair.split("=");
      if (/Max-Age=0(;|$)/.test(line)) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
    return response;
  };

  /** The whole sign-in: start, the person at the issuer, the callback. */
  const signIn = async (person: AuthorizeOptions = {}, path = "/auth/sign-in?return_to=%2Faccount") => {
    const started = await send(path);
    const location = started.headers.get("location") ?? "";
    const query = await issuer.authorize(location, { claims: { exp: Math.floor((now() + HOUR) / 1000) }, ...person });
    return await send(`/auth/callback?${query}`);
  };

  const me = async () => {
    const response = await send("/api/me");
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  return { auth, clock, client, env, issuer, jar, me, records, send, signIn };
};

describe("GET /auth/sign-in", () => {
  it("keeps the pending sign-in on the server and names it with a host-only __Host- cookie", async () => {
    const { send, issuer, records } = await setup();
    const response = await send("/auth/sign-in?return_to=%2Faccount");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(new RegExp(`^${issuer.issuer}/oidc/auth\\?client_id=`));
    const [line = ""] = response.headers.getSetCookie();
    expect(line).toMatch(new RegExp(`^${PENDING_COOKIE}=[A-Za-z0-9_-]{43}; `));
    for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]) {
      expect(line.split("; ")).toContain(attribute);
    }
    expect(line).not.toMatch(/Domain=/i);
    expect([...records.keys()]).toEqual([expect.stringMatching(/^pending:/)]);
  });

  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "account"])(
    "refuses return_to %j with 400 INVALID_REQUEST and no cookie",
    async (returnTo) => {
      const { send, records } = await setup();
      const response = await send(`/auth/sign-in?${new URLSearchParams({ return_to: returnTo })}`);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("INVALID_REQUEST");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(records.size).toBe(0);
    }
  );

  it("refuses a button of the other class before any request to the issuer", async () => {
    const { send, issuer } = await setup({ signInClass: "person" });
    const response = await send("/auth/sign-in?class=team&return_to=%2F");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("WRONG_CLASS");
    expect(issuer.requests).toEqual([]);
  });

  it("answers 503 naming each missing setting, and the sector document still serves", async () => {
    const { send } = await setup({ env: { COMMS_ID_CLIENT_ID: "", COMMS_ID_PRIVATE_JWK: "" } });
    const response = await send("/auth/sign-in");
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("COMMS_ID_CLIENT_ID");
    expect(text).toContain("COMMS_ID_PRIVATE_JWK");
    expect((await send("/oidc/redirect_uris")).status).toBe(200);
  });
});

describe("GET /auth/callback", () => {
  it("signs a person in: a session cookie, the pairwise sub at /api/me, no Team", async () => {
    const { signIn, me, jar, client } = await setup();
    const response = await signIn();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/account");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith(SESSION_COOKIE)) ?? "";
    for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
      expect(line.split("; ")).toContain(attribute);
    }
    expect(line).not.toMatch(/Domain=/i);
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    const { status, body } = await me();
    expect(status).toBe(200);
    expect(body).toMatchObject({ signedIn: true, renew: false, signInClass: "person" });
    expect(body.profile).toEqual({ sub: `fake-subject-${client.clientId}` });
  });

  it("uses the pending sign-in once: a replayed callback is NO_PENDING_SIGN_IN", async () => {
    const { send, issuer, jar } = await setup();
    const started = await send("/auth/sign-in");
    const pending = jar.get(PENDING_COOKIE) ?? "";
    const query = await issuer.authorize(started.headers.get("location") ?? "");
    expect((await send(`/auth/callback?${query}`)).status).toBe(303);
    jar.set(PENDING_COOKIE, pending);
    jar.delete(SESSION_COOKIE);
    const replay = await send(`/auth/callback?${query}`);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("NO_PENDING_SIGN_IN");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses a callback whose state is not this sign-in's: STATE_MISMATCH", async () => {
    const { send, issuer, jar } = await setup();
    const started = await send("/auth/sign-in");
    const query = await issuer.authorize(started.headers.get("location") ?? "");
    query.set("state", "not-the-state");
    const response = await send(`/auth/callback?${query}`);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("STATE_MISMATCH");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  // ADR-0068 invariants at the route: each refused with its code, and no session.
  it.each<[string, AuthorizeOptions, string]>([
    ["a wrong nonce", { claims: { nonce: "other" } }, "INVALID_ID_TOKEN"],
    ["another audience", { claims: { aud: "another-client" } }, "INVALID_ID_TOKEN"],
    ["another issuer", { claims: { iss: "https://other-issuer.comms.id.invalid" } }, "INVALID_ID_TOKEN"],
    ["an algorithm other than ML-DSA-87", { header: { alg: "ES256" } }, "INVALID_ID_TOKEN"],
    ["an expired ID token", { claims: { exp: 1 } }, "INVALID_ID_TOKEN"],
    ["a key not in the issuer's JWKS", { signWithOtherKey: true }, "INVALID_ID_TOKEN"],
    ["an issuer error", { error: "access_denied" }, "SIGN_IN_REFUSED"],
  ])("refuses %s", async (_, person, code) => {
    const { signIn, jar, records } = await setup();
    const response = await signIn(person);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(code);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect([...records.keys()].filter((name) => name.startsWith("session:"))).toEqual([]);
  });

  it("refuses a Team sign-in in a person app: WRONG_CLASS", async () => {
    const { signIn, jar } = await setup({ signInClass: "person" });
    const response = await signIn({ teamMembership: team });
    expect(await response.text()).toContain("WRONG_CLASS");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("signs a person in for a Team when the app's class is team", async () => {
    const { signIn, me } = await setup({ signInClass: "team" });
    await signIn({ teamMembership: team }, "/auth/sign-in?class=team&return_to=%2F");
    const { body } = await me();
    expect(body).toMatchObject({ signedIn: true, signInClass: "team", profile: { teamMembership: team } });
  });
});

describe("renewal", () => {
  it("asks for a renewal 5 minutes before expiry, 401 renew inside the grace, plain 401 after it", async () => {
    const { signIn, me, clock } = await setup();
    const start = clock.now;
    await signIn();
    clock.now = start + HOUR - 4 * MINUTE;
    expect(await me()).toMatchObject({ status: 200, body: { signedIn: true, renew: true } });
    clock.now = start + HOUR + 5 * MINUTE;
    expect(await me()).toMatchObject({ status: 401, body: { signedIn: false, renew: true } });
    clock.now = start + HOUR + 11 * MINUTE;
    expect(await me()).toMatchObject({ status: 401, body: { signedIn: false, renew: false } });
  });

  it("renews silently after expiry with prompt=none and keeps the same sub", async () => {
    const { send, signIn, me, clock, issuer, records } = await setup();
    const start = clock.now;
    await signIn();
    const before = (await me()).body.profile;
    clock.now = start + HOUR + 2 * MINUTE;
    const renewing = await send("/auth/renew?return_to=%2Faccount");
    expect(renewing.status).toBe(302);
    const par = issuer.requests.at(-1)?.form;
    expect(par?.get("prompt")).toBe("none");
    expect(par?.get("id_token_hint")).toMatch(/^ey/);
    const query = await issuer.authorize(renewing.headers.get("location") ?? "", {
      claims: { exp: Math.floor((clock.now + HOUR) / 1000) },
    });
    expect((await send(`/auth/callback?${query}`)).status).toBe(303);
    expect(await me()).toMatchObject({ status: 200, body: { signedIn: true, profile: before } });
    expect([...records.keys()].filter((name) => name.startsWith("session:"))).toHaveLength(1);
  });

  it("signs the person out when the issuer answers login_required (SIGN_IN_AGAIN)", async () => {
    const { send, signIn, me, issuer, jar, records } = await setup();
    await signIn();
    const renewing = await send("/auth/renew?return_to=%2Faccount");
    const query = await issuer.authorize(renewing.headers.get("location") ?? "", { error: "login_required" });
    const response = await send(`/auth/callback?${query}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/account");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect([...records.keys()].filter((name) => name.startsWith("session:"))).toEqual([]);
    expect((await me()).status).toBe(401);
  });

  it("sends a browser with no session to sign in instead", async () => {
    const { send } = await setup();
    const response = await send("/auth/renew?return_to=%2Faccount");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/auth/sign-in?return_to=%2Faccount");
  });
});

describe("POST /auth/sign-out", () => {
  it("refuses a post from another origin with 403 and keeps the session", async () => {
    const { send, signIn, me } = await setup();
    await signIn();
    const response = await send("/auth/sign-out", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect((await me()).status).toBe(200);
  });

  it("ends the session for a post from this origin", async () => {
    const { send, signIn, me, records } = await setup();
    await signIn();
    const response = await send("/auth/sign-out", { method: "POST", headers: { origin: ORIGIN } });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect((await me()).status).toBe(401);
    expect(records.size).toBe(0);
  });

  it("checks the Origin against the registered origin, not the URL a runtime rebuilt", async () => {
    const { send, signIn, me } = await setup();
    await signIn();
    const response = await send("http://internal.invalid/auth/sign-out", { method: "POST", headers: { origin: ORIGIN } });
    expect(response.status).toBe(303);
    expect((await me()).status).toBe(401);
  });

  it("refuses a foreign Origin even when the request URL was rebuilt on another host", async () => {
    const { send, signIn, me } = await setup();
    await signIn();
    const response = await send("http://internal.invalid/auth/sign-out", {
      method: "POST",
      headers: { origin: "http://internal.invalid" },
    });
    expect(response.status).toBe(403);
    expect((await me()).status).toBe(200);
  });

  it.each(["", "not a url"])("answers 503 NOT_CONFIGURED when COMMS_ID_REDIRECT_URI is %j", async (redirectUri) => {
    const { send } = await setup({ env: { COMMS_ID_REDIRECT_URI: redirectUri } });
    const response = await send("/auth/sign-out", { method: "POST", headers: { origin: ORIGIN } });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("NOT_CONFIGURED");
  });
});

describe("the other routes", () => {
  it("serves the sector document: a JSON array of the one redirect URI", async () => {
    const { send } = await setup();
    const response = await send("/oidc/redirect_uris");
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual([`${ORIGIN}/auth/callback`]);
  });

  it("names the commit at /health", async () => {
    const { send } = await setup();
    expect(await (await send("/health")).text()).toBe("commit 0123abc\n");
  });

  it("answers /api/me with no-store and the security headers", async () => {
    const { send } = await setup();
    const response = await send("/api/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("leaves every other path to the app", async () => {
    const { auth } = await setup();
    expect(await auth.handle(new Request(`${ORIGIN}/`))).toBeUndefined();
  });
});

const team = {
  version: 1,
  teamId: "fake-team",
  teamName: "Fake Team",
  ownerEntityId: "fake-entity",
  ownerEntityName: "Fake Entity",
  isManagingTeam: false,
} as const;
