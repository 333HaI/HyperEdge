import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders HyperEdge", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>HyperEdge - Live Perp Intelligence<\/title>/i,
  );
  assert.match(html, /Hybrid Edge Radar/);
  assert.match(html, /Rule discovery \+ walk-forward validation/);
  assert.match(html, /Hyperliquid mainnet/);
  assert.match(html, /Action queue/);
  assert.match(html, /Trade Journal/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the cross-venue intelligence route", async () => {
  const response = await render("/venues");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>Venue Lens \| HyperEdge<\/title>/i);
  assert.match(html, /Cross-venue market evidence/);
  assert.match(html, /Cross-venue comparisons/);
  assert.match(html, /Hyperliquid \/ Lighter \/ Variational/);
});

test("server-renders the Hyperliquid trade journal route", async () => {
  const response = await render("/paper");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(
    html,
    /<title>Trade Journal \| HyperEdge<\/title>/i,
  );
  assert.match(html, /Paper trade tracking/);
  assert.match(html, /Trade Journal/);
  assert.match(html, /No paper trades are being tracked/);
  assert.doesNotMatch(html, /Yahoo marks|simulated spreads/i);
});
