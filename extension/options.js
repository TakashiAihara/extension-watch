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

document.getElementById("save").addEventListener("click", async () => {
  if (!url.value || !url.checkValidity()) return (status.textContent = "Enter an http(s) URL");
  const parsed = new URL(url.value);
  // fetch rejects URLs with credentials. ntfy takes an access token in the token field, or a whole
  // Authorization header value as ?auth= (base64url-encoded).
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
