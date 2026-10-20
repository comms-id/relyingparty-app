// Shows the session the Worker keeps (GET /api/me) and renews it silently near its expiry.
const me = await fetch("/api/me", { headers: { accept: "application/json" } });
const body = await me.json();

// Renew at most once a minute, so a renewal that cannot help never loops.
const renewedAt = Number(sessionStorage.getItem("comms-id-renewed-at") ?? 0);

if (body.renew && Date.now() - renewedAt > 60_000) {
  // A silent sign-in (prompt=none): the person sees nothing unless the issuer asks them to sign in again.
  sessionStorage.setItem("comms-id-renewed-at", String(Date.now()));
  location.assign(`/auth/renew?return_to=${encodeURIComponent(location.pathname)}`);
} else if (body.signedIn) {
  document.getElementById("sub").textContent = body.profile.sub;
  if (body.profile.teamMembership) {
    document.getElementById("team").textContent = body.profile.teamMembership.teamName;
    document.getElementById("team").hidden = false;
    document.getElementById("team-label").hidden = false;
  }
  document.getElementById("expires").textContent = new Date(body.expiresAt).toLocaleTimeString();
  document.getElementById("signed-in").hidden = false;
} else {
  document.querySelector("comms-id-sign-in").setAttribute("sign-in-class", body.signInClass);
  document.getElementById("signed-out").hidden = false;
}
