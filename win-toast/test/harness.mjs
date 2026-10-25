// Offline harness: loads the host plugin with a fake cordis context and fires
// the four event kinds, capturing the screen after each so the toast itself can
// be verified visually. Run: node test/harness.mjs
// Paths are repo-relative so the plugin can live anywhere on disk.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../lib/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, "capture.ps1");
const OUT = join(HERE, ".tmp");
mkdirSync(OUT, { recursive: true });

const handlers = new Map();
const fakeCtx = {
  on(event, callback) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(callback);
    return () => {};
  },
  get() {
    return undefined;
  },
};

apply(fakeCtx, {});

const session = { id: "s1" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fireSessionEvent(type, data) {
  for (const callback of handlers.get("session/event") ?? []) callback(session, { type, data });
}

function capture(name) {
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE, "-Path", join(OUT, name)], {
    stdio: "ignore",
  });
  console.log("captured", name);
}

const next = () => Promise.resolve("unavailable");

fireSessionEvent("assistant/message", {
  message: { content: [{ type: "text", text: "我已经把 Windows 通知插件写好了，重启 DSH 后生效。" }] },
});
fireSessionEvent("turn/end", { turn: 1, reason: { kind: "completed" } });
await sleep(2600);
capture("tmp-win-toast-1-completed.png");

fireSessionEvent("turn/end", {
  turn: 2,
  reason: { kind: "error", error: { message: "模型请求超时：upstream timed out after 60000ms", code: "TIMEOUT" } },
});
await sleep(2600);
capture("tmp-win-toast-2-error.png");

await (handlers.get("user-questions/request") ?? [])[0]?.(
  { questions: [{ id: "q1", header: "确认安装", question: "是否允许把插件链接进 desktop profile 并重启？" }] },
  next,
);
await sleep(2600);
capture("tmp-win-toast-3-question.png");

await (handlers.get("approval/request") ?? [])[0]?.({ toolName: "bash", reason: "write outside workspace" }, next);
await sleep(2600);
capture("tmp-win-toast-4-approval.png");

console.log("HARNESS OK");
