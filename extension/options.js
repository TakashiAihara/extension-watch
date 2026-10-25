const url = document.getElementById("url");
const status = document.getElementById("status");
const error = document.getElementById("error");

const { ntfyUrl, lastError } = await chrome.storage.local.get(["ntfyUrl", "lastError"]);
url.value = ntfyUrl ?? "";
error.textContent = lastError ?? "none";
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastError) error.textContent = changes.lastError.newValue ?? "none";
});

document.getElementById("save").addEventListener("click", async () => {
  if (!url.value || !url.checkValidity()) return (status.textContent = "Enter an http(s) URL");
  const parsed = new URL(url.value);
  // fetch rejects URLs with credentials; ntfy takes them as ?auth= instead.
  if (parsed.username || parsed.password) return (status.textContent = "Put credentials in ?auth=, not in user:pass@");
  // Host permission for the ntfy origin only, so the POST does not depend on the server's CORS headers.
  const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
  if (!granted) return (status.textContent = "Permission for the ntfy origin was not granted");
  await chrome.storage.local.set({ ntfyUrl: url.value });
  status.textContent = "Saved";
});
