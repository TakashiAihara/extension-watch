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
// The sender stops while the policy cannot be read, and that policy may hold the URL, so it comes first.
// With no URL set, a send can only fail for that reason, so the header keeps saying Not configured.
const renderState = () => {
  const key = policyError ? "error" : !configured ? "unset" : lastError ? "error" : "watching";
  state.dataset.state = key;
  stateText.textContent = STATES[key];
};

const stored = await chrome.storage.local.get(["ntfyUrl", "ntfyToken", "lastError"]);
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
