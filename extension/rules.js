// Returns why a URL and token cannot be used together, or "" when they can.
export function tokenProblem(url, token) {
  if (!token) return "";
  // ntfy tokens are tk_ plus letters and digits; a space or other character means a bad paste.
  if (!/^[\x21-\x7e]+$/.test(token)) return "The token must be printable ASCII without spaces";
  const u = new URL(url);
  // ntfy reads ?auth= instead of the Authorization header when both are present (readAuthHeader).
  if (u.searchParams.has("auth")) return "Use either the token field or ?auth= in the URL, not both";
  // Loopback stays allowed for local testing; anywhere else the token would travel in cleartext.
  if (u.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return "A token needs an https URL";
  return "";
}
