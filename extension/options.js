import { tokenProblem } from "./rules.js";

const url = document.getElementById("url");
const token = document.getElementById("token");
const status = document.getElementById("status");
const error = document.getElementById("error");

const { ntfyUrl, ntfyToken, lastError } = await chrome.storage.local.get(["ntfyUrl", "ntfyToken", "lastError"]);
url.value = ntfyUrl ?? "";
token.value = ntfyToken ?? "";
error.textContent = lastError ?? "none";
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastError) error.textContent = changes.lastError.newValue ?? "none";
});

// The saved token must not follow the URL to another server unnoticed, so clear it when the origin changes.
url.addEventListener("input", () => {
  try {
    if (ntfyUrl && token.value === ntfyToken && new URL(url.value).origin !== new URL(ntfyUrl).origin) token.value = "";
  } catch {
    // An unfinished URL does not parse yet.
  }
});

document.getElementById("save").addEventListener("click", async () => {
  if (!url.value || !url.checkValidity()) return (status.textContent = "Enter an http(s) URL");
  const parsed = new URL(url.value);
  // fetch rejects URLs with credentials. ntfy takes an access token in the token field, or user:pass as ?auth=.
  if (parsed.username || parsed.password) {
    return (status.textContent = "Use an access token, or ?auth= in the URL, instead of user:pass@");
  }
  const t = token.value.trim();
  const problem = tokenProblem(url.value, t);
  if (problem) return (status.textContent = problem);
  // Host permission for the ntfy origin only, so the POST does not depend on the server's CORS headers.
  const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  if (!granted) return (status.textContent = "Permission for the ntfy origin was not granted");
  await chrome.storage.local.set({ ntfyUrl: url.value, ntfyToken: t });
  status.textContent = "Saved";
});
