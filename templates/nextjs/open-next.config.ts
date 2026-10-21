import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig(),
  // Next.js itself, not "pnpm build": this template has its own pnpm-workspace.yaml, and pnpm started
  // inside it would install there first.
  buildCommand: "next build",
};
