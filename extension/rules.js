// ntfy reads credentials from either query parameter (server_auth.go).
const AUTH_PARAMS = ["auth", "authorization"];
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

// Returns why a URL and token cannot be used together, or "" when they can.
export function tokenProblem(url, token) {
  const u = new URL(url);
  // fetch rejects URLs with credentials. ntfy takes an access token in the token field, or a whole
  // Authorization header value as ?auth= (base64url-encoded).
  if (u.username || u.password) return "Use an access token, or ?auth= in the URL, instead of user:pass@";
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

// Returns {} when no policy is set (the manifest always declares the schema). A failure is not caught:
// falling back to the options page would send around a policy the administrator set.
export function readManaged() {
  return chrome.storage.managed.get(["ntfyUrl", "ntfyToken"]);
}
