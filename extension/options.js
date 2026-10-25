const url = document.getElementById("url");
const status = document.getElementById("status");

const { ntfyUrl, lastError } = await chrome.storage.local.get(["ntfyUrl", "lastError"]);
url.value = ntfyUrl ?? "";
document.getElementById("error").textContent = lastError ?? "none";

document.getElementById("save").addEventListener("click", async () => {
  if (!url.checkValidity() || !url.value) return (status.textContent = "Enter a valid URL");
  await chrome.storage.local.set({ ntfyUrl: url.value });
  status.textContent = "Saved";
});
