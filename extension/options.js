import { formatTime } from "./history.js";
import { readManaged, tokenProblem } from "./rules.js";

const url = document.getElementById("url");
const token = document.getElementById("token");
const status = document.getElementById("status");
const error = document.getElementById("error");

const state = document.querySelector("#state");
const stateText = document.querySelector("#state-text");

const show = (text, kind = "") => {
  status.textContent = text;
  status.dataset.kind = kind;
};

const STATES = { watching: "Watching", unset: "Not configured", error: "Error" };
// Changes are held while the policy cannot be read, and that policy may hold the URL, so it comes first.
// With no URL set, Not configured is the first thing to fix, so it wins over a stored last error.
const renderState = () => {
  const key = policyError ? "error" : !configured ? "unset" : lastError ? "error" : "watching";
  state.dataset.state = key;
  stateText.textContent = STATES[key];
};

const stored = await chrome.storage.local.get(["ntfyUrl", "ntfyToken", "lastError", "history"]);
url.value = stored.ntfyUrl ?? "";
token.value = stored.ntfyToken ?? "";
error.textContent = stored.lastError ?? "none";

// A URL pushed by policy wins, so the page shows it and does not offer settings that would not apply.
let policyError = false;
const managed = await readManaged().catch((err) => {
  policyError = true;
  show(`Cannot read the policy: ${err.message}`, "error");
  return {};
});
if (managed.ntfyUrl) {
  url.value = managed.ntfyUrl;
  token.value = "";
  token.placeholder = managed.ntfyToken ? "Set by your administrator" : "";
  for (const el of [url, token, document.querySelector("#save")]) el.disabled = true;
  show("Set by your administrator through policy", "policy");
}
let configured = Boolean(managed.ntfyUrl || stored.ntfyUrl);
let lastError = stored.lastError;
renderState();

chrome.storage.onChanged.addListener((changes, area) => {
  // The page was laid out for the policy read at load, so a policy change needs a fresh read.
  if (area === "managed") return location.reload();
  if (area !== "local") return;
  if (changes.lastError) {
    lastError = changes.lastError.newValue;
    error.textContent = lastError ?? "none";
  }
  if (changes.ntfyUrl) configured = Boolean(managed.ntfyUrl || changes.ntfyUrl.newValue);
  if (changes.lastError || changes.ntfyUrl) renderState();
  if (changes.history) renderHistory(changes.history.newValue);
});

document.getElementById("save").addEventListener("click", async () => {
  if (!url.value || !url.checkValidity()) return show("Enter an http(s) URL", "error");
  const parsed = new URL(url.value);
  const t = token.value.trim();
  const problem = tokenProblem(url.value, t);
  if (problem) return show(problem, "error");
  // Host permission for the ntfy origin only, so the POST does not depend on the server's CORS headers.
  const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  if (!granted) return show("Permission for the ntfy origin was not granted", "error");
  await chrome.storage.local.set({ ntfyUrl: url.value, ntfyToken: t });
  show("Saved", "saved");
});

function renderHistory(entries = []) {
  document.querySelector("#history-count").textContent = String(entries.length);
  document.querySelector("#history-empty").hidden = entries.length > 0;
  const rows = entries.map((e) => {
    const li = document.createElement("li");
    li.className = "entry";
    const time = document.createElement("time");
    time.dateTime = new Date(e.at).toISOString();
    time.textContent = formatTime(e.at);
    const who = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = e.name;
    const id = document.createElement("code");
    id.textContent = e.id;
    id.title = e.id;
    who.append(name, id);
    const what = document.createElement("div");
    const lines = document.createElement("ul");
    for (const line of e.lines) {
      const item = document.createElement("li");
      item.textContent = line;
      lines.append(item);
    }
    what.append(lines);
    const note = { pending: "Not sent yet", replaced: "Not sent: it changed again before the retry" }[e.state];
    if (note) {
      const mark = document.createElement("span");
      mark.className = "unsent";
      mark.textContent = note;
      what.append(mark);
    }
    li.append(time, who, what);
    return li;
  });
  document.querySelector("#history-list").replaceChildren(...rows);
}
renderHistory(stored.history);

// Tabs follow the ARIA tabs pattern: click or arrow keys switch, only the selected tab is in the tab order.
const tabs = [...document.querySelectorAll('[role="tab"]')];
const select = (tab) => {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  tab.focus();
};
for (const tab of tabs) {
  tab.addEventListener("click", () => select(tab));
  tab.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) select(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]);
  });
}
