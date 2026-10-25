// Offline test for the Host bridge consumed by lib/client.js.
//
// It loads the plugin with a fake cordis context, captures the registered
// /win-toast/focus route, and exercises the request-file contract that
// lib/focus.ps1 writes and lib/client.js consumes. The request file is per
// Host pid; the legacy shared name is still read for toasts raised by 0.3.0.
// Run: node test/bridge.mjs
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

const REQUEST_FILE = join(tmpdir(), `dsh-toast-focus-${process.pid}.json`);
const LEGACY_FILE = join(tmpdir(), "dsh-toast-focus.json");
const ROUTE_PATH = "/win-toast/focus";

rmSync(REQUEST_FILE, { force: true });
rmSync(LEGACY_FILE, { force: true });

const handlers = new Map();
const routes = [];
const fakeCtx = {
  on(event, callback) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(callback);
    return () => {};
  },
  get() {
    return undefined;
  },
  inject(dependencies, callback) {
    assert.deepEqual(dependencies, ["webServer"]);
    callback({
      webServer: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
      effect(run) {
        run();
      },
    });
    return () => {};
  },
};

apply(fakeCtx, {});
assert.equal(routes.length, 1, "expected exactly one registered route");
const route = routes[0];
assert.equal(route.kind, "exact");
assert.equal(route.path, ROUTE_PATH);

async function call({ method = "GET", origin = "dsh-app://dsh", host = "dsh-app" } = {}) {
  let status = 0;
  let headers;
  let raw = "";
  const response = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
      return response;
    },
    end(chunk) {
      raw += String(chunk ?? "");
    },
  };
  await route.handler({ method, headers: { origin, host, "user-agent": "Mozilla/5.0", "accept-language": "zh-CN" } }, response);
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  return { status, headers, body };
}

// A fresh request is consumed exactly once.
writeFileSync(REQUEST_FILE, JSON.stringify({ sessionId: "session-test-123", at: Date.now() }), "utf8");
const first = await call();
assert.equal(first.status, 200);
assert.equal(first.headers["cache-control"], "no-store");
assert.equal(first.body.sessionId, "session-test-123");
assert.equal(existsSync(REQUEST_FILE), false, "request file should be removed after consumption");

// Windows PowerShell 5.1 prefixes the JSON with a UTF-8 BOM; it must parse.
writeFileSync(REQUEST_FILE, "\uFEFF" + JSON.stringify({ sessionId: "bom-session", at: Date.now() }), "utf8");
const bom = await call();
assert.equal(bom.status, 200);
assert.equal(bom.body.sessionId, "bom-session");
assert.equal(existsSync(REQUEST_FILE), false, "BOM request should be consumed too");

// No request -> null session, still 200 so the client keeps polling calmly.
const empty = await call();
assert.equal(empty.status, 200);
assert.equal(empty.body.sessionId, null);

// Expired requests are ignored and dropped.
writeFileSync(REQUEST_FILE, JSON.stringify({ sessionId: "stale", at: Date.now() - 6 * 60_000 }), "utf8");
const stale = await call();
assert.equal(stale.body.sessionId, null);
assert.equal(existsSync(REQUEST_FILE), false);

// A half-written file must survive for the next poll, not be consumed.
writeFileSync(REQUEST_FILE, "{not json", "utf8");
const partial = await call();
assert.equal(partial.body.sessionId, null);
assert.equal(existsSync(REQUEST_FILE), true, "partial request must remain for the next poll");
rmSync(REQUEST_FILE, { force: true });

// Another DSH instance's file must never be consumed by this Host.
const foreignFile = join(tmpdir(), `dsh-toast-focus-${process.pid + 1}.json`);
writeFileSync(foreignFile, JSON.stringify({ sessionId: "foreign", at: Date.now() }), "utf8");
const foreign = await call();
assert.equal(foreign.body.sessionId, null);
assert.equal(existsSync(foreignFile), true, "another instance's request must be left alone");
rmSync(foreignFile, { force: true });

// The per-pid file wins over the legacy shared file.
writeFileSync(REQUEST_FILE, JSON.stringify({ sessionId: "own-pid", at: Date.now() }), "utf8");
writeFileSync(LEGACY_FILE, JSON.stringify({ sessionId: "legacy", at: Date.now() }), "utf8");
const precedence = await call();
assert.equal(precedence.body.sessionId, "own-pid");
assert.equal(existsSync(LEGACY_FILE), true, "legacy file must not be touched when a per-pid request exists");
rmSync(LEGACY_FILE, { force: true });

// A toast raised by 0.3.0 carries no pid and still works through the legacy file.
writeFileSync(LEGACY_FILE, JSON.stringify({ sessionId: "legacy-session", at: Date.now() }), "utf8");
const legacy = await call();
assert.equal(legacy.body.sessionId, "legacy-session");
assert.equal(existsSync(LEGACY_FILE), false, "legacy request should be consumed");

// Cross-origin and non-GET calls are refused.
const crossOrigin = await call({ origin: "https://evil.example", host: "dsh-app" });
assert.equal(crossOrigin.status, 403);
const post = await call({ method: "POST" });
assert.equal(post.status, 405);

console.log("BRIDGE OK");
