import { describe, expect, it } from "vitest";
import worker from "../src/worker";

const assets = { fetch: async () => new Response("front page") };

describe("the site Worker", () => {
  it("names the commit it runs at /health", async () => {
    const response = await worker.fetch(new Request("https://relyingparty.app/health"), { ASSETS: assets, COMMIT_SHA: "0123abc" });
    expect(await response.text()).toBe("commit 0123abc\n");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves every other path to the static front page", async () => {
    const response = await worker.fetch(new Request("https://relyingparty.app/"), { ASSETS: assets });
    expect(await response.text()).toBe("front page");
  });
});
