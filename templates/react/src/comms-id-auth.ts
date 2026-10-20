// Sign in with Comms.ID on this app's server: the routes, the cookies and the session.
// Framework-neutral (a Request in, a Response out) and the same file in every relyingparty.app
// template; only the adapter around it differs. The sign-in itself is @comms-id/sign-in/flow
// (OpenID Connect at IdX: PAR, PKCE, private_key_jwt, ML-DSA-87; platform ADR-0068).
//
// GET  /auth/sign-in?return_to=   start a sign-in; the pending record stays on this server
// GET  /auth/callback             finish it: one use of the pending record, then a session
// GET  /auth/renew?return_to=     a silent sign-in (prompt=none) before or just after expiry
// POST /auth/sign-out             end this app's session (IdX has no end-session endpoint)
// GET  /api/me                    the signed-in profile, or 401
// GET  /oidc/redirect_uris        this app's sector document: its one redirect URI
// GET  /health                    "commit <sha>"

import { CommsIdError } from "@comms-id/sign-in";
import { createSignInFlow, type PendingSignIn, type Profile, type SignInFlow } from "@comms-id/sign-in/flow";

/** The settings a relying party supplies. Only COMMS_ID_PRIVATE_JWK is a secret. */
export interface CommsIdEnv {
  /** The commit this Worker runs, for /health. */
  readonly COMMIT_SHA?: string;
  /** The client id Companion gave this app when it was registered. */
  readonly COMMS_ID_CLIENT_ID?: string;
  /** https://exchange.comms.id */
  readonly COMMS_ID_ISSUER?: string;
  /** The ML-DSA-87 private JWK `npx comms-id key` wrote: a Worker secret, never a var or a file. */
  readonly COMMS_ID_PRIVATE_JWK?: string;
  /** https://<this app's host>/auth/callback, as registered. */
  readonly COMMS_ID_REDIRECT_URI?: string;
  /** "person" (the default) or "team": the class this app's registration accepts. */
  readonly COMMS_ID_SIGN_IN_CLASS?: string;
}

/**
 * Where the pending sign-ins and the sessions live: one record per name, gone at deleteAt.
 * In a Worker it is one Durable Object per name (session-store.ts); in tests, a Map.
 */
export interface RecordStore {
  readonly delete: (name: string) => Promise<void>;
  readonly get: (name: string) => Promise<unknown>;
  readonly put: (name: string, value: unknown, deleteAt: number) => Promise<void>;
  /** Reads and deletes the record in one step, so it is used once. */
  readonly take: (name: string) => Promise<unknown>;
}

/** The session this app keeps on its server. The browser holds only its random id. */
export interface Session {
  /** When the ID token expires, in milliseconds since the epoch. */
  readonly expiresAt: number;
  /** The verified ID token: the id_token_hint of a renewal. */
  readonly idToken: string;
  readonly profile: Profile;
}

/** What /api/me answers, and what a server-rendered page shows. */
export type Me =
  | { readonly signedIn: true; readonly profile: Profile; readonly expiresAt: number; readonly renew: boolean }
  | { readonly signedIn: false; readonly renew: boolean };

export interface CommsIdAuthOptions {
  readonly env: CommsIdEnv;
  /** The issuer is called with this fetch: the fake issuer's in tests. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly store: RecordStore;
}

export interface CommsIdAuth {
  /** Answers this module's routes, or undefined for any other path. */
  readonly handle: (request: Request) => Promise<Response | undefined>;
  /** The session a request's cookie names. */
  readonly me: (cookieHeader: string | null) => Promise<Me>;
}

export const PENDING_COOKIE = "__Host-rp-pending";
export const SESSION_COOKIE = "__Host-rp-session";

const PENDING_MS = 10 * 60_000;
/** A session is kept this long after its ID token expires, so it can still be renewed silently. */
const GRACE_MS = 10 * 60_000;
/** /api/me asks for a renewal this long before the ID token expires. */
const RENEW_AHEAD_MS = 5 * 60_000;
const REQUIRED = ["COMMS_ID_ISSUER", "COMMS_ID_CLIENT_ID", "COMMS_ID_REDIRECT_URI", "COMMS_ID_PRIVATE_JWK"] as const;
/** The issuer did not answer, or answered with something the flow cannot use. */
const UPSTREAM = new Set(["NETWORK", "INVALID_DISCOVERY"]);

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
};

const respond = (body: BodyInit | null, status: number, headers: Record<string, string> = {}, cookies: string[] = []) => {
  const response = new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  respond(JSON.stringify(body), status, { "content-type": "application/json; charset=utf-8", ...headers });

const redirect = (location: string, status: 302 | 303, cookies: string[] = []) =>
  respond(null, status, { location }, cookies);

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** A page that names what went wrong: the error code and its message, never a token or a key. */
const errorPage = (status: number, code: string, message: string, cookies: string[] = []) =>
  respond(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sign-in: ${escapeHtml(code)}</title>` +
      `<h1>Sign-in stopped: ${escapeHtml(code)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back</a></p></html>`,
    status,
    { "content-type": "text/html; charset=utf-8" },
    cookies
  );

/** A __Host- cookie: HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain, so it stays on this host. */
const cookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;

const clearCookie = (name: string) => cookie(name, "", 0);

const cookieValue = (header: string | null, name: string): string | undefined => {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      const value = rest.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
};

/** 32 random bytes, base64url: 43 characters. */
const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asPending = (value: unknown): PendingSignIn | undefined =>
  isRecord(value) &&
  typeof value.nonce === "string" &&
  typeof value.state === "string" &&
  typeof value.verifier === "string" &&
  typeof value.returnTo === "string"
    ? (value as unknown as PendingSignIn)
    : undefined;

const asSession = (value: unknown): Session | undefined =>
  isRecord(value) &&
  typeof value.expiresAt === "number" &&
  typeof value.idToken === "string" &&
  isRecord(value.profile) &&
  typeof value.profile.sub === "string"
    ? (value as unknown as Session)
    : undefined;

const pendingName = (id: string) => `pending:${id}`;
const sessionName = (id: string) => `session:${id}`;

const setting = (value: string | undefined) => (value === undefined || value.trim() === "" ? undefined : value.trim());

/** The origin of an https URL, or undefined. */
const originOf = (url: string | undefined) => {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
};

/** The configured class: "person" unless COMMS_ID_SIGN_IN_CLASS says otherwise. */
const signInClassOf = (env: CommsIdEnv) => setting(env.COMMS_ID_SIGN_IN_CLASS) ?? "person";

export const createCommsIdAuth = (options: CommsIdAuthOptions): CommsIdAuth => {
  const { env, store } = options;
  const now = () => options.now?.() ?? Date.now();

  /** The flow, or the reason this app cannot sign anyone in yet. */
  const flowOrMissing = (): SignInFlow | { readonly missing: string } => {
    const missing = REQUIRED.filter((name) => setting(env[name]) === undefined);
    if (missing.length > 0) {
      return { missing: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.` };
    }
    let privateJwk: unknown;
    try {
      privateJwk = JSON.parse(setting(env.COMMS_ID_PRIVATE_JWK) as string);
    } catch {
      return { missing: "COMMS_ID_PRIVATE_JWK is not a JSON Web Key." };
    }
    try {
      return createSignInFlow({
        issuer: setting(env.COMMS_ID_ISSUER) as string,
        clientId: setting(env.COMMS_ID_CLIENT_ID) as string,
        redirectUri: setting(env.COMMS_ID_REDIRECT_URI) as string,
        privateJwk: privateJwk as Parameters<typeof createSignInFlow>[0]["privateJwk"],
        signInClass: signInClassOf(env) as "person" | "team",
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    } catch (error) {
      if (error instanceof CommsIdError) {
        return { missing: `${error.code}: ${error.message}` };
      }
      throw error;
    }
  };

  const notConfigured = (missing: string) =>
    errorPage(503, "NOT_CONFIGURED", `This app is not set up for Sign in with Comms.ID yet: ${missing}`);

  /** A refused sign-in: the code names why, and no session cookie is set. */
  const refused = (error: unknown, cookies: string[] = []) => {
    if (!(error instanceof CommsIdError)) {
      throw error;
    }
    return errorPage(UPSTREAM.has(error.code) ? 502 : 400, error.code, error.message, cookies);
  };

  const sessionOf = async (cookieHeader: string | null) => {
    const id = cookieValue(cookieHeader, SESSION_COOKIE);
    if (id === undefined) {
      return undefined;
    }
    const session = asSession(await store.get(sessionName(id)));
    return session === undefined ? undefined : { id, session };
  };

  /** Keeps the pending record on this server and sends the browser to the issuer. */
  const toIssuer = async (begin: () => Promise<{ url: string; pending: PendingSignIn }>) => {
    let started: { url: string; pending: PendingSignIn };
    try {
      started = await begin();
    } catch (error) {
      return refused(error);
    }
    const id = randomId();
    await store.put(pendingName(id), started.pending, now() + PENDING_MS);
    return redirect(started.url, 302, [cookie(PENDING_COOKIE, id, PENDING_MS / 1000)]);
  };

  const signIn = async (url: URL) => {
    const signInClass = url.searchParams.get("class");
    if (signInClass !== null && signInClass !== signInClassOf(env)) {
      return errorPage(
        400,
        "WRONG_CLASS",
        `This app signs people in with the class "${signInClassOf(env)}", not "${signInClass}".`
      );
    }
    const flow = flowOrMissing();
    if ("missing" in flow) {
      return notConfigured(flow.missing);
    }
    const returnTo = url.searchParams.get("return_to") ?? "/";
    return await toIssuer(() => flow.start({ returnTo }));
  };

  const callback = async (request: Request, url: URL) => {
    const flow = flowOrMissing();
    if ("missing" in flow) {
      return notConfigured(flow.missing);
    }
    const cookieHeader = request.headers.get("cookie");
    const pendingId = cookieValue(cookieHeader, PENDING_COOKIE);
    const pending = pendingId === undefined ? undefined : asPending(await store.take(pendingName(pendingId)));
    const cookies = [clearCookie(PENDING_COOKIE)];
    const previous = await sessionOf(cookieHeader);
    let signedIn: Awaited<ReturnType<SignInFlow["finish"]>>;
    try {
      signedIn = await flow.finish({ query: url.searchParams, pending });
    } catch (error) {
      if (error instanceof CommsIdError && error.code === "SIGN_IN_AGAIN" && pending !== undefined) {
        // A silent renewal the issuer refused: this app's session ends, and the person signs in again.
        if (previous !== undefined) {
          await store.delete(sessionName(previous.id));
        }
        return redirect(pending.returnTo, 303, [...cookies, clearCookie(SESSION_COOKIE)]);
      }
      return refused(error, cookies);
    }
    if (previous !== undefined) {
      await store.delete(sessionName(previous.id));
    }
    const id = randomId();
    const session: Session = { profile: signedIn.profile, idToken: signedIn.idToken, expiresAt: signedIn.expiresAt };
    const deleteAt = signedIn.expiresAt + GRACE_MS;
    await store.put(sessionName(id), session, deleteAt);
    return redirect(signedIn.returnTo, 303, [...cookies, cookie(SESSION_COOKIE, id, (deleteAt - now()) / 1000)]);
  };

  const renew = async (request: Request, url: URL) => {
    const returnTo = url.searchParams.get("return_to") ?? "/";
    const current = await sessionOf(request.headers.get("cookie"));
    if (current === undefined) {
      return redirect(`/auth/sign-in?${new URLSearchParams({ return_to: returnTo })}`, 303);
    }
    const flow = flowOrMissing();
    if ("missing" in flow) {
      return notConfigured(flow.missing);
    }
    return await toIssuer(() => flow.renew({ idTokenHint: current.session.idToken, returnTo }));
  };

  const signOut = async (request: Request) => {
    // A form on another site cannot end this session: only this app's own origin may post here. The
    // registered redirect URI names that origin, however a runtime rebuilds request.url.
    const origin = originOf(setting(env.COMMS_ID_REDIRECT_URI));
    if (origin === undefined) {
      return notConfigured("COMMS_ID_REDIRECT_URI is not set to an https URL.");
    }
    if (request.headers.get("origin") !== origin) {
      return errorPage(403, "FORBIDDEN_ORIGIN", "Sign out from this app's own page.");
    }
    const current = await sessionOf(request.headers.get("cookie"));
    if (current !== undefined) {
      await store.delete(sessionName(current.id));
    }
    return redirect("/", 303, [clearCookie(SESSION_COOKIE)]);
  };

  const me = async (cookieHeader: string | null): Promise<Me> => {
    const current = await sessionOf(cookieHeader);
    if (current === undefined) {
      return { signedIn: false, renew: false };
    }
    const { profile, expiresAt } = current.session;
    if (now() >= expiresAt + GRACE_MS) {
      return { signedIn: false, renew: false };
    }
    if (now() >= expiresAt) {
      return { signedIn: false, renew: true };
    }
    return { signedIn: true, profile, expiresAt, renew: now() >= expiresAt - RENEW_AHEAD_MS };
  };

  const handle = async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    switch (route) {
      case "GET /auth/sign-in":
        return await signIn(url);
      case "GET /auth/callback":
        return await callback(request, url);
      case "GET /auth/renew":
        return await renew(request, url);
      case "POST /auth/sign-out":
        return await signOut(request);
      case "GET /api/me": {
        // signInClass: the class the page's button asks for.
        const body = await me(request.headers.get("cookie"));
        return json({ ...body, signInClass: signInClassOf(env) }, body.signedIn ? 200 : 401);
      }
      case "GET /oidc/redirect_uris": {
        const redirectUri = setting(env.COMMS_ID_REDIRECT_URI);
        return redirectUri === undefined
          ? json({ error: "NOT_CONFIGURED", message: "COMMS_ID_REDIRECT_URI is not set." }, 503)
          : json([redirectUri], 200, { "cache-control": "public, max-age=300" });
      }
      case "GET /health":
        return respond(`commit ${setting(env.COMMIT_SHA) ?? "unknown"}\n`, 200, {
          "content-type": "text/plain; charset=utf-8",
        });
      default:
        return ["/auth/sign-in", "/auth/callback", "/auth/renew", "/auth/sign-out", "/api/me"].includes(url.pathname)
          ? respond("Method Not Allowed\n", 405, { "content-type": "text/plain; charset=utf-8" })
          : undefined;
    }
  };

  return { handle, me };
};

/** One Durable Object per record name: the stub methods of SessionRecords in session-store.ts. */
export interface RecordsNamespace {
  readonly getByName: (name: string) => {
    readonly delete: () => Promise<void>;
    readonly get: () => Promise<unknown>;
    readonly put: (value: unknown, deleteAt: number) => Promise<void>;
    readonly take: () => Promise<unknown>;
  };
}

/** The RecordStore of a Worker: each pending sign-in and each session is its own Durable Object. */
export const durableStore = (namespace: RecordsNamespace): RecordStore => ({
  delete: (name) => namespace.getByName(name).delete(),
  get: (name) => namespace.getByName(name).get(),
  put: (name, value, deleteAt) => namespace.getByName(name).put(value, deleteAt),
  take: (name) => namespace.getByName(name).take(),
});
