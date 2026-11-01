// ntfy reads credentials from either query parameter (server_auth.go).
const AUTH_PARAMS = ["auth", "authorization"];
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

// Returns why a URL and token cannot be used together, or "" when they can.
export function tokenProblem(url, token) {
  const u = new URL(url);
  const inUrl = AUTH_PARAMS.some((k) => u.searchParams.get(k));
  if (token) {
    // ntfy tokens are tk_ plus letters and digits; a space or other character means a bad paste.
    if (!/^[\x21-\x7e]+$/.test(token)) return "The token must be printable ASCII without spaces";
    // ntfy reads the query parameter instead of the Authorization header when both are present.
    if (inUrl) return "Use either the token field or ?auth= in the URL, not both";
  }
  // Loopback stays allowed for local testing; anywhere else the credentials would travel in cleartext.
  if ((token || inUrl) && u.protocol === "http:" && !LOOPBACK.includes(u.hostname)) return "Credentials need an https URL";
  return "";
}
