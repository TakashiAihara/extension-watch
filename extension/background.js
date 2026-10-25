import { diff, snapshot, split } from "./diff.js";

// A reload fires onDisabled(old), onEnabled(new) and onInstalled(new) within ~10 ms (measured on
// Chrome for Testing 156). Waiting lets them read as one update; 2 s is margin, as the order of a
// store auto-update is not measured.
const SETTLE_MS = 2000;
// Catches what fires no management event (optional permissions granted at runtime) and retries
// failed sends.
const ALARM = "check";
const PERIOD_MIN = 5;
// ntfy's default message-size-limit is 4096 bytes and servers without attachments reject longer
// bodies with 400; the rest is room for the "(1/2) " prefix.
const MAX_BYTES = 4080;
const SEND_TIMEOUT_MS = 10000;

let timer;
let running = Promise.resolve();

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    running = running.then(check).catch(() => {});
  }, SETTLE_MS);
}

async function check() {
  try {
    await run();
    await chrome.storage.local.set({ lastError: null });
    await chrome.action.setBadgeText({ text: "" });
  } catch (err) {
    await chrome.storage.local.set({ lastError: `${new Date().toISOString()} ${err.message}` });
    await chrome.action.setBadgeText({ text: "!" });
  }
}

async function run() {
  const infos = await chrome.management.getAll();
  const warnings = {};
  // Throws for an extension uninstalled since getAll; the next check drops it.
  for (const e of infos) warnings[e.id] = await chrome.management.getPermissionWarningsById(e.id).catch(() => []);
  const next = snapshot(infos, chrome.runtime.id, warnings);
  const lang = chrome.i18n.getUILanguage();
  const { extensions: prev, ntfyUrl, warningsLang } = await chrome.storage.local.get([
    "extensions",
    "ntfyUrl",
    "warningsLang",
  ]);

  // First run: take a baseline instead of reporting every existing extension as new.
  if (!prev) return chrome.storage.local.set({ extensions: next, warningsLang: lang });

  // Warnings are localized; after a UI language change they would all read as added and removed.
  if (warningsLang !== lang) {
    for (const id of Object.keys(prev)) if (next[id]) prev[id] = { ...prev[id], warnings: next[id].warnings };
    await chrome.storage.local.set({ warningsLang: lang });
  }

  // One message per extension, so one failing send does not hold back the others. A failed
  // extension keeps its old record, so the same change is sent on the next check.
  const saved = { ...next };
  let error;
  for (const { id, message } of diff(prev, next)) {
    try {
      await send(ntfyUrl, message);
    } catch (err) {
      error ??= err;
      if (prev[id]) saved[id] = prev[id];
      else delete saved[id];
    }
  }
  await chrome.storage.local.set({ extensions: saved });
  if (error) throw error;
}

async function send(ntfyUrl, message) {
  if (!ntfyUrl) throw new Error("ntfy URL is not set");
  const url = new URL(ntfyUrl);
  url.searchParams.set("title", "extension-watch");
  const parts = split(message, MAX_BYTES);
  // A failed part fails the whole extension, so parts sent before it are sent again on the retry.
  for (const [i, part] of parts.entries()) {
    const body = parts.length > 1 ? `(${i + 1}/${parts.length}) ${part}` : part;
    const res = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ntfy ${res.status}`);
  }
}

// Recreated on every worker start if missing, not only on install and browser startup.
chrome.alarms.get(ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
});

chrome.management.onInstalled.addListener(schedule);
chrome.management.onEnabled.addListener(schedule);
chrome.management.onDisabled.addListener(schedule);
chrome.management.onUninstalled.addListener(schedule);
chrome.alarms.onAlarm.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.runtime.onInstalled.addListener(schedule);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.ntfyUrl) schedule();
});
