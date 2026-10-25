import { diff, snapshot } from "./diff.js";

// An update arrives as onDisabled(old) then onInstalled(new); wait so it reads as one update, not a disable.
const SETTLE_MS = 2000;

let timer;
let running = Promise.resolve();

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    running = running.then(check, check);
  }, SETTLE_MS);
}

async function check() {
  const next = snapshot(await chrome.management.getAll(), chrome.runtime.id);
  const { extensions: prev, ntfyUrl } = await chrome.storage.local.get(["extensions", "ntfyUrl"]);

  // First run: take a baseline instead of reporting every existing extension as new.
  if (!prev) return chrome.storage.local.set({ extensions: next });

  const messages = diff(prev, next);
  if (messages.length) {
    try {
      if (!ntfyUrl) throw new Error("ntfy URL is not set");
      const url = new URL(ntfyUrl);
      url.searchParams.set("title", "extension-watch");
      // text/plain with no custom headers is a CORS simple request, so no host permission is needed.
      const res = await fetch(url, { method: "POST", body: messages.join("\n\n") });
      if (!res.ok) throw new Error(`ntfy ${res.status}`);
    } catch (err) {
      // Keep the old snapshot so the same changes are sent on the next check.
      await chrome.storage.local.set({ lastError: `${new Date().toISOString()} ${err.message}` });
      await chrome.action.setBadgeText({ text: "!" });
      return;
    }
  }
  await chrome.storage.local.set({ extensions: next, lastError: null });
  await chrome.action.setBadgeText({ text: "" });
}

chrome.management.onInstalled.addListener(schedule);
chrome.management.onEnabled.addListener(schedule);
chrome.management.onDisabled.addListener(schedule);
chrome.management.onUninstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.runtime.onInstalled.addListener(schedule);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.ntfyUrl) schedule();
});
