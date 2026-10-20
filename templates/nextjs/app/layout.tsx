import type { ReactNode } from "react";
import "./styles.css";

export const metadata = { title: "Sign in with Comms.ID: Next.js template" };

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
