// Host-side plugin for DSH: Windows native toast notifications.
//
// Fires a real Windows notification (Action Center + banner) when a turn
// finishes, when a turn ends in an error, when the agent asks the human a
// question, and when a tool approval is waiting. Toasts are raised by
// lib/toast.ps1 through the WinRT toast API under a stable AppUserModelId, so
// they appear under the name "DSH Win Toast" instead of a script host.
//
// Each toast is independent: no Tag/Group is set, so Windows queues banners
// and keeps each entry in Action Center until its ExpirationTime. Clicking
// still restores DSH and opens the matching conversation.
//
// Clicking a toast runs focus.ps1, which brings the DSH window forward and
// records the session id carried by the toast activation URI. The GET route
// /win-toast/focus hands that request to lib/client.js, which navigates the
// Web UI to the matching conversation through uiWorkspace.openSession().
//
// These listeners never answer approvals or questions themselves: they only
// notice the request and delegate with next(), exactly like the built-in UI
// expects.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOAST_SCRIPT = join(HERE, "toast.ps1");
const IS_WINDOWS = process.platform === "win32";

// Focus requests are written by lib/focus.ps1 (through the wscript shim) and
// consumed by the route below on the next client poll. The file is per Host
// process: several DSH instances share %TEMP%, and a single file made them
// steal each other's click.
const FOCUS_REQUEST_PREFIX = "dsh-toast-focus-";
const LEGACY_FOCUS_REQUEST_FILE = join(tmpdir(), "dsh-toast-focus.json");
const FOCUS_ROUTE = "/win-toast/focus";
const FOCUS_REQUEST_TTL_MS = 5 * 60_000;

/** Per-process focus request file; the Host consumes only its own. */
function focusRequestFile(pid = process.pid) {
  return join(tmpdir(), `${FOCUS_REQUEST_PREFIX}${pid}.json`);
}

// The plugin owns its own identity. Registering a custom AUMID under
// HKCU\Software\Classes\AppUserModelId makes Windows show our chosen name in
// Settings and on the toast itself.
const AUMID = "Dsh.WinToast";
const APP_NAME = "DSH Win Toast";

// process.execPath is the Electron binary when this plugin runs inside the
// desktop app, and plain node.exe when it runs under the CLI. It is used only
// to relaunch DSH if a click finds no window; it is deliberately not used as
// the toast icon, so the plugin never presents itself as the official app.
const APP_PATH = IS_WINDOWS && process.execPath && !/node(\.exe)?$/i.test(process.execPath) ? process.execPath : "";

const WINDOWS_POWERSHELL = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

const DEFAULTS = {
  // One switch per event kind.
  onTurnEnd: true,
  onError: true,
  onBlocked: true,
  onQuestion: true,
  onApproval: true,
  // A user-pressed stop is not news; opt in if you want it.
  onAbort: false,
  // Subagent turns share the same session event stream; off by default.
  notifySubagents: false,
  // Skip a toast while the DSH window itself is in front.
  skipWhenFocused: false,
  // Clicking the toast brings the DSH window back and opens this conversation.
  onActivate: true,
  // Play the default notification sound.
  sound: true,
  // Body text limit (code points) before truncation.
  bodyLimit: 180,
  // "short" disappears from the banner quickly; "long" keeps it up longer.
  duration: "short",
  // Hard expiry of the notification in Action Center, in seconds (0 = never).
  expireSeconds: 30,
  // Notification language: "auto" follows the OS/UI locale, or force "zh"/"en".
  locale: "auto",
  // Process names used by skipWhenFocused and by the click handler to find the
  // desktop window. The app executable is still named "DeepSeek Harness".
  focusProcessNames: ["DeepSeek Harness"],
};

const MESSAGES = {
  zh: {
    completedTitle: "任务完成",
    completedBody: "本轮对话已结束，等你下一步。",
    maxTokensTitle: "输出达到上限",
    maxTokensBody: "本轮回答已达到最大输出长度。",
    errorTitle: "出错",
    errorBody: "本轮执行出错，详情见 DSH。",
    blockedTitle: "本轮被阻塞",
    blockedBody: "本轮被策略或前置条件阻塞，详情见 DSH。",
    abortedTitle: "已中止",
    abortedBody: "本轮任务已被中止。",
    approvalTitle: "需要审批",
    toolLabel: "工具",
    questionTitle: "需要你的回答",
    questionBody: "有一个问题需要你回答。",
    reason: (reason) => `（${reason}）`,
  },
  en: {
    completedTitle: "Task complete",
    completedBody: "This turn has finished; waiting for your next step.",
    maxTokensTitle: "Output limit reached",
    maxTokensBody: "This turn reached the maximum output length.",
    errorTitle: "Error",
    errorBody: "This turn failed; see DSH for details.",
    blockedTitle: "Turn blocked",
    blockedBody: "This turn was blocked before it could continue; see DSH for details.",
    abortedTitle: "Aborted",
    abortedBody: "This turn was stopped.",
    approvalTitle: "Approval needed",
    toolLabel: "tool",
    questionTitle: "Your answer is needed",
    questionBody: "There is a question waiting for your answer.",
    reason: (reason) => ` (${reason})`,
  },
};

function resolveLocale(options) {
  const requested = String(options.locale ?? "auto").toLowerCase();
  if (requested === "zh" || requested === "en") return requested;
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().locale;
    if (/^zh/i.test(detected)) return "zh";
    if (/^en/i.test(detected)) return "en";
  } catch {
    /* fall through to Chinese, the plugin author's default */
  }
  return "zh";
}

function clamp(text, limit) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return [...flat].slice(0, limit).join("") + "…";
}

function messageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const parts = [];
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function normalizedExpireSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULTS.expireSeconds;
  return Math.min(Math.floor(seconds), 24 * 60 * 60);
}

/** Activation URI for one toast; carries the session and target process. */
function activationUri(options, sessionId, windowTitle) {
  if (options.onActivate === false) return "";
  const base = typeof options.activateUri === "string" && options.activateUri.trim() !== ""
    ? options.activateUri.trim()
    : "dshfocus://focus";
  const params = new URLSearchParams();
  if (sessionId) params.set("session", String(sessionId));
  // Several DSH instances can be open at once. Carrying the Host pid lets the
  // click handler focus that instance and write a request only it consumes.
  params.set("pid", String(process.pid));
  // The click handler treats this value as a process name when pid lookup
  // fails, so it must be the DSH executable name, not the toast display name.
  const focusNames = Array.isArray(options.focusProcessNames) && options.focusProcessNames.length > 0
    ? options.focusProcessNames
    : DEFAULTS.focusProcessNames;
  params.set("app", String(focusNames[0]));
  if (windowTitle) params.set("title", String(windowTitle).slice(0, 200));
  const query = params.toString();
  if (query === "") return base;
  try {
    const url = new URL(base);
    for (const [key, value] of params) url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return base + (base.includes("?") ? "&" : "?") + query;
  }
}

function requestScheme(value) {
  try {
    return new URL(String(value)).protocol;
  } catch {
    return "";
  }
}

/**
 * Refuse callers that are not this page.
 *
 * The desktop shell sends requests from the `dsh-app:` scheme, which Chromium
 * may present with no Origin at all; that shape is accepted only when it looks
 * like a real renderer. A same-authority http(s) origin is accepted for the
 * plain `dsh web` GUI.
 */
function sameOrigin(request) {
  const origin = String(request.headers.origin ?? "").trim();
  const referer = String(request.headers.referer ?? "");
  const appSchemes = ["dsh-app:", "file:"];
  if (appSchemes.includes(requestScheme(origin))) return true;
  if (appSchemes.includes(requestScheme(referer))) return true;
  if (origin !== "") {
    try {
      if (new URL(origin).host === String(request.headers.host ?? "")) return true;
    } catch {
      /* malformed origin: fall through to the refusals */
    }
  }
  if (origin === "") {
    const agent = String(request.headers["user-agent"] ?? "");
    const language = String(request.headers["accept-language"] ?? "");
    if (/^Mozilla\/5\.0/.test(agent) && language !== "") return true;
  }
  return false;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

/**
 * Read and consume one focus request file.
 *
 * A partially written file is left in place for the next poll instead of being
 * deleted: focus.ps1 publishes it with an atomic rename. The `found` flag lets
 * the caller distinguish "no file for this instance" from "this instance has a
 * file that is not ready yet" — the latter must not fall through to the legacy
 * shared file and steal another instance's click.
 */
function readFocusRequest(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { found: false, value: undefined };
  }
  let parsed;
  try {
    // Windows PowerShell 5.1 writes UTF-8 with a BOM; JSON.parse rejects it.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, "").trim());
  } catch {
    return { found: true, value: undefined };
  }
  try {
    rmSync(file, { force: true });
  } catch {
    /* another poll may have consumed it already */
  }
  const sessionId = typeof parsed?.sessionId === "string" ? parsed.sessionId.trim() : "";
  if (sessionId === "") return { found: true, value: undefined };
  const at = Number(parsed?.at);
  if (Number.isFinite(at) && Date.now() - at > FOCUS_REQUEST_TTL_MS) {
    return { found: true, value: undefined };
  }
  return { found: true, value: { sessionId, at: Number.isFinite(at) ? at : Date.now() } };
}

function consumeFocusRequest() {
  const own = readFocusRequest(focusRequestFile(process.pid));
  if (own.found) return own.value;
  // Toasts raised by an older build carry no pid and used the shared file.
  return readFocusRequest(LEGACY_FOCUS_REQUEST_FILE).value;
}

/** Register the one-shot bridge endpoint consumed by lib/client.js. */
function registerFocusBridge(ctx) {
  if (typeof ctx.inject !== "function") return;
  try {
    ctx.inject(["webServer"], (scope) => {
      if (!scope?.webServer || typeof scope.webServer.register !== "function") return;
      scope.effect(() => scope.webServer.register({
        kind: "exact",
        path: FOCUS_ROUTE,
        handler(request, response) {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { ok: false, error: "cross-origin request refused" });
            return;
          }
          if (request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "GET only" });
            return;
          }
          const focus = consumeFocusRequest();
          sendJson(response, 200, { ok: true, sessionId: focus?.sessionId ?? null });
        },
      }));
    });
  } catch {
    // The bridge is a convenience; notifications keep working without it.
  }
}

export function apply(ctx, config = {}) {
  const options = { ...DEFAULTS, ...config };
  const messages = MESSAGES[resolveLocale(options)];
  let pending = 0;

  // One short-lived PowerShell process per toast: a missed notice can never
  // block or fail an approval, and nothing stays resident between events.
  function showToast(toast) {
    if (!IS_WINDOWS) return;
    if (pending >= 6) return;
    // Reserve the slot before any fallible work: every failure path below can
    // then release exactly once, and a mkdtempSync failure can never decrement
    // a slot it did not take.
    pending += 1;
    let dir;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      pending = Math.max(0, pending - 1);
    };
    try {
      dir = mkdtempSync(join(tmpdir(), "dsh-win-toast-"));
      const payloadFile = join(dir, "payload.json");
      const payload = {
        title: clamp(toast.title, 120) || APP_NAME,
        body: clamp(toast.body, options.bodyLimit),
        appName: APP_NAME,
        appPath: APP_PATH,
        aumid: AUMID,
        silent: options.sound === false || toast.silent === true,
        skipWhenFocused: options.skipWhenFocused === true,
        focusProcessNames: Array.isArray(options.focusProcessNames) && options.focusProcessNames.length > 0
          ? options.focusProcessNames
          : DEFAULTS.focusProcessNames,
        // Protocol handler registered by toast.ps1: a click restores DSH and
        // asks the client half to open this session.
        activateUri: activationUri(options, toast.sessionId, toast.windowTitle),
        duration: options.duration === "long" ? "long" : "short",
        expireSeconds: normalizedExpireSeconds(options.expireSeconds),
      };
      writeFileSync(payloadFile, JSON.stringify(payload), "utf8");
      // NOT detached on purpose: libuv maps detached to DETACHED_PROCESS,
      // which gives the child no console, and Windows PowerShell 5.1 then
      // fails silently inside the WinRT toast call (exit 0, no banner, no
      // Action Center entry — verified on Windows 11 25H2). Plain
      // windowsHide + ignore keeps a console window from flashing, and
      // unref keeps DSH from waiting on it.
      const child = spawn(
        WINDOWS_POWERSHELL,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", TOAST_SCRIPT, "-PayloadPath", payloadFile],
        { stdio: "ignore", windowsHide: true },
      );
      // `error` and `exit` can both fire for the same child; release once.
      child.once("error", release);
      child.once("exit", release);
      child.unref();
      const timer = setTimeout(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch {}
      }, 30_000);
      if (typeof timer.unref === "function") timer.unref();
    } catch {
      release();
      try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  function isSubagentSession(session) {
    try {
      const agents = ctx.get?.("agents");
      if (!agents) return false;
      const agent = agents.get?.(session?.id);
      // The registry can lag behind the event stream. Unknown means "not
      // proven to be a subagent": notify rather than silently swallow a turn.
      if (!agent) return false;
      if (typeof agents.roots === "function" && !agents.roots().includes(agent)) return true;
      return false;
    } catch {
      return false;
    }
  }

  // Last assistant text per session, used as the completion toast body.
  const lastText = new Map();

  // turn/end carries the reason (completed / error / blocked / aborted /
  // max-tokens), unlike agent/turn-stopping which only means "no more steps".
  ctx.on("session/event", (session, event) => {
    try {
      if (!session || !event) return;
      if (event.type === "assistant/message") {
        const text = messageText(event.data?.message);
        if (text.trim() !== "") {
          if (lastText.size >= 200) {
            const oldest = lastText.keys().next().value;
            lastText.delete(oldest);
          }
          lastText.set(session, text);
        }
        return;
      }
      if (event.type !== "turn/end") return;
      if (!options.notifySubagents && isSubagentSession(session)) return;

      const reason = event.data?.reason ?? {};
      const last = lastText.get(session) ?? "";
      const sessionId = typeof session?.id === "string" ? session.id : "";
      const windowTitle = typeof session?.title === "string" ? session.title : "";
      lastText.delete(session);

      switch (reason.kind) {
        case "completed":
          if (!options.onTurnEnd) return;
          showToast({ title: messages.completedTitle, body: last || messages.completedBody, sessionId, windowTitle });
          return;
        case "max-tokens":
          if (!options.onTurnEnd) return;
          showToast({ title: messages.maxTokensTitle, body: last || messages.maxTokensBody, sessionId, windowTitle });
          return;
        case "error":
          if (!options.onError) return;
          showToast({ title: messages.errorTitle, body: reason.error?.message || messages.errorBody, sessionId, windowTitle });
          return;
        case "blocked":
          if (!options.onBlocked) return;
          showToast({ title: messages.blockedTitle, body: messages.blockedBody, sessionId, windowTitle });
          return;
        case "aborted":
          if (!options.onAbort) return;
          showToast({ title: messages.abortedTitle, body: messages.abortedBody, sessionId, windowTitle });
          return;
        default:
          return;
      }
    } catch {
      // Notifications must never disturb the session.
    }
  }, { global: true });

  if (options.onApproval) {
    ctx.on("approval/request", (req, next) => {
      try {
        const tool = req?.toolName ?? messages.toolLabel;
        const reason = req?.reason ? messages.reason(req.reason) : "";
        const sessionId = typeof req?.agent?.id === "string" ? req.agent.id : "";
        const windowTitle = typeof req?.agent?.title === "string" ? req.agent.title : "";
        showToast({ title: messages.approvalTitle, body: `${tool}${reason}`, sessionId, windowTitle });
      } catch {}
      return next();
    }, { prepend: true });
  }

  if (options.onQuestion) {
    ctx.on("user-questions/request", (req, next) => {
      try {
        const question = req?.questions?.[0];
        const sessionId = typeof req?.agent?.id === "string" ? req.agent.id : "";
        const windowTitle = typeof req?.agent?.title === "string" ? req.agent.title : "";
        showToast({
          title: question?.header ? String(question.header) : messages.questionTitle,
          body: question?.question ?? question?.label ?? messages.questionBody,
          sessionId,
          windowTitle,
        });
      } catch {}
      return next();
    }, { prepend: true });
  }

  registerFocusBridge(ctx);
}

export const name = "dsh-win-toast";
export { DEFAULTS };
