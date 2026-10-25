import { diff, snapshot } from "./diff.js";

// A reload fires onDisabled(old), onEnabled(new) and onInstalled(new) within ~10 ms (measured on
// Chrome for Testing 156). Waiting lets them read as one update; 2 s is margin, as the order of a
// store auto-update is not measured.
const SETTLE_MS = 2000;
// Catches what fires no management event (optional permissions granted at runtime) and retries
// failed sends.
const ALARM = "check";
const PERIOD_MIN = 5;
// ntfy's default message-size-limit; servers without attachments reject longer bodies with 400.
const MAX_BYTES = 4096;

let timer;
let running = Promise.resolve();

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    running = running.then(check);
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
  for (const e of infos) warnings[e.id] = await chrome.management.getPermissionWarningsById(e.id);
  const next = snapshot(infos, chrome.runtime.id, warnings);
  const { extensions: prev, ntfyUrl } = await chrome.storage.local.get(["extensions", "ntfyUrl"]);

  // First run: take a baseline instead of reporting every existing extension as new.
  if (!prev) return chrome.storage.local.set({ extensions: next });

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
  let body = message;
  while (new TextEncoder().encode(body).length > MAX_BYTES) body = body.slice(0, -64);
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

function start() {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
  schedule();
}

chrome.management.onInstalled.addListener(schedule);
chrome.management.onEnabled.addListener(schedule);
chrome.management.onDisabled.addListener(schedule);
chrome.management.onUninstalled.addListener(schedule);
chrome.alarms.onAlarm.addListener(schedule);
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.ntfyUrl) schedule();
});
