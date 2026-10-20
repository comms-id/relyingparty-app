// The page: the session the Worker keeps (GET /api/me), the Sign in with Comms.ID button, sign-out.
import { SignInButton } from "@comms-id/sign-in-react";
import { useEffect, useState } from "react";

interface Profile {
  readonly sub: string;
  readonly teamMembership?: { readonly teamName: string };
}

type Me =
  | { readonly signedIn: true; readonly profile: Profile; readonly expiresAt: number; readonly renew: boolean }
  | { readonly signedIn: false; readonly renew: boolean; readonly signInClass: "person" | "team" };

export const App = () => {
  const [me, setMe] = useState<Me>();

  useEffect(() => {
    void fetch("/api/me", { headers: { accept: "application/json" } })
      .then((response) => response.json() as Promise<Me>)
      .then((body) => {
        // Renew at most once a minute, so a renewal that cannot help never loops.
        const renewedAt = Number(sessionStorage.getItem("comms-id-renewed-at") ?? 0);
        if (body.renew && Date.now() - renewedAt > 60_000) {
          // A silent sign-in (prompt=none): the person sees nothing unless the issuer asks them to sign in again.
          sessionStorage.setItem("comms-id-renewed-at", String(Date.now()));
          location.assign(`/auth/renew?return_to=${encodeURIComponent(location.pathname)}`);
          return;
        }
        setMe(body);
      });
  }, []);

  return (
    <main>
      <p className="eyebrow">
        <a href="https://relyingparty.app">relyingparty.app</a> · React template
      </p>
      <h1>Sign in with Comms.ID</h1>
      <p>
        A React app and a small Worker. The page shows <code>SignInButton</code> from{" "}
        <code>@comms-id/sign-in-react</code>; the Worker runs the sign-in at IdX and keeps the session on the server.
      </p>

      {me?.signedIn === false && (
        <section>
          <SignInButton start="/auth/sign-in" signInClass={me.signInClass} returnTo="/" />
        </section>
      )}

      {me?.signedIn === true && (
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
            <dt>Session renews before</dt>
            <dd>{new Date(me.expiresAt).toLocaleTimeString()}</dd>
          </dl>
          <p className="note">The id is pairwise: another app sees a different id for you.</p>
          <form method="post" action="/auth/sign-out">
            <button type="submit">Sign out</button>
          </form>
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
};
