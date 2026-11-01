import { readManaged, tokenProblem } from "./rules.js";

const url = document.getElementById("url");
const token = document.getElementById("token");
const status = document.getElementById("status");
const error = document.getElementById("error");

const { ntfyUrl, ntfyToken, lastError } = await chrome.storage.local.get(["ntfyUrl", "ntfyToken", "lastError"]);
url.value = ntfyUrl ?? "";
token.value = ntfyToken ?? "";
error.textContent = lastError ?? "none";

// A URL pushed by policy wins, so the page shows it and does not offer settings that would not apply.
const managed = await readManaged().catch((err) => {
  status.textContent = `Cannot read the policy: ${err.message}`;
  return {};
});
if (managed.ntfyUrl) {
  url.value = managed.ntfyUrl;
  token.value = "";
  token.placeholder = managed.ntfyToken ? "Set by your administrator" : "";
  for (const el of [url, token, document.querySelector("#save")]) el.disabled = true;
  status.textContent = "Set by your administrator through policy";
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastError) error.textContent = changes.lastError.newValue ?? "none";
});

document.getElementById("save").addEventListener("click", async () => {
  if (!url.value || !url.checkValidity()) return (status.textContent = "Enter an http(s) URL");
  const parsed = new URL(url.value);
  const t = token.value.trim();
  const problem = tokenProblem(url.value, t);
  if (problem) return (status.textContent = problem);
  // Host permission for the ntfy origin only, so the POST does not depend on the server's CORS headers.
  const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  if (!granted) return (status.textContent = "Permission for the ntfy origin was not granted");
  await chrome.storage.local.set({ ntfyUrl: url.value, ntfyToken: t });
  status.textContent = "Saved";
});
