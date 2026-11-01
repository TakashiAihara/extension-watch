// ntfy reads credentials from either query parameter (server_auth.go).
const AUTH_PARAMS = ["auth", "authorization"];
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

// Returns why a URL and token cannot be used together, or "" when they can.
export function tokenProblem(url, token) {
  const u = new URL(url);
  // Every value counts: a second ?auth= still travels in the URL even though ntfy reads only the first.
  const inUrl = AUTH_PARAMS.some((k) => u.searchParams.getAll(k).some((v) => v));
  if (token) {
    // ntfy tokens are tk_ plus letters and digits; a space or other character means a bad paste.
    if (!/^[\x21-\x7e]+$/.test(token)) return "The token must be printable ASCII without spaces";
    // ntfy reads the query parameter instead of the Authorization header when both are present.
    if (inUrl) return "Use either the token field or credentials in the URL, not both";
  }
  // Loopback stays allowed for local testing; anywhere else the credentials would travel in cleartext.
  if ((token || inUrl) && u.protocol === "http:" && !LOOPBACK.includes(u.hostname)) return "Credentials need an https URL";
  return "";
}

// Settings an administrator pushes through policy (managed storage) win over the options page, and
// the URL and token always come from the same place, so a token never goes to a URL it was not set with.
export function pickConfig(managed, local) {
  if (managed?.ntfyUrl) return { ntfyUrl: managed.ntfyUrl, ntfyToken: managed.ntfyToken ?? "", managed: true };
  return { ntfyUrl: local?.ntfyUrl, ntfyToken: local?.ntfyToken ?? "", managed: false };
}

// chrome.storage.managed throws when no policy schema applies (unpacked builds without one, tests).
export async function readManaged() {
  try {
    return await chrome.storage.managed.get(["ntfyUrl", "ntfyToken"]);
  } catch {
    return {};
  }
}
