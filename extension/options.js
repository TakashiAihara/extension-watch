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
  // fetch rejects URLs with credentials; ntfy takes them as ?auth= instead.
  if (parsed.username || parsed.password) return (status.textContent = "Put credentials in the token field, not in user:pass@");
  const t = token.value.trim();
  if (t && !/^[\x21-\x7e]+$/.test(t)) return (status.textContent = "The token has characters a header cannot hold");
  // Host permission for the ntfy origin only, so the POST does not depend on the server's CORS headers.
  const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  if (!granted) return (status.textContent = "Permission for the ntfy origin was not granted");
  await chrome.storage.local.set({ ntfyUrl: url.value, ntfyToken: t });
  status.textContent = "Saved";
});
