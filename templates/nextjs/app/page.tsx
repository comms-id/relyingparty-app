// The page, rendered on the server: it reads this app's session (the shared core's me) from the
// request's cookie. The browser never holds a token, only the session cookie.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { commsIdAuth, signInClass } from "../src/auth";
import { SignInButton } from "./sign-in-button";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await commsIdAuth().me((await headers()).get("cookie"));
  if (!me.signedIn && me.renew) {
    // The ID token expired a moment ago: a silent sign-in (prompt=none) renews the session.
    redirect("/auth/renew?return_to=%2F");
  }

  return (
    <main>
      <p className="eyebrow">
        <a href="https://relyingparty.app">relyingparty.app</a> · Next.js template
      </p>
      <h1>Sign in with Comms.ID</h1>
      <p>
        A Next.js app on Cloudflare Workers. The page is rendered on the server with the session it keeps; route
        handlers run the sign-in at IdX.
      </p>

      {me.signedIn ? (
        <section>
          <h2>You are signed in</h2>
          <dl>
            <dt>Your id in this app</dt>
            <dd>
              <code>{me.profile.sub}</code>
            </dd>
            {me.profile.teamMembership && (
              <>
                <dt>Team</dt>
                <dd>{me.profile.teamMembership.teamName}</dd>
              </>
            )}
            <dt>Session renews after</dt>
            <dd>{new Date(me.expiresAt).toISOString()}</dd>
          </dl>
          <p className="note">The id is pairwise: another app sees a different id for you.</p>
          <form method="post" action="/auth/sign-out">
            <button type="submit">Sign out</button>
          </form>
        </section>
      ) : (
        <section>
          <SignInButton start="/auth/sign-in" signInClass={signInClass()} returnTo="/" />
        </section>
      )}

      <footer>
        <p>
          <a href="https://comms.id/docs/reference/sign-in">Sign in with Comms.ID docs</a> ·{" "}
          <a href="https://relyingparty.app">Copy this template</a>
        </p>
      </footer>
    </main>
  );
}
