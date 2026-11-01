import { expect, test } from "bun:test";
import { authParam, pickConfig, tokenProblem } from "../extension/rules.js";

const T = "tk_sample0";

test("no credentials are always fine, even over http", () => {
  expect(tokenProblem("http://ntfy.example.com/t", "")).toBe("");
});

test("an https URL with a plain token is fine, and loopback http is allowed", () => {
  expect(tokenProblem("https://ntfy.example.com/t", T)).toBe("");
  expect(tokenProblem("http://127.0.0.1:8080/t", T)).toBe("");
  expect(tokenProblem("http://localhost/t", T)).toBe("");
  expect(tokenProblem("http://[::1]/t", T)).toBe("");
});

test("credentials are refused over http to another host, in the token field or the URL", () => {
  expect(tokenProblem("http://ntfy.example.com/t", T)).toBe("Credentials need an https URL");
  expect(tokenProblem("http://ntfy.example.com/t?auth=abc", "")).toBe("Credentials need an https URL");
  expect(tokenProblem("http://ntfy.example.com/t?authorization=abc", "")).toBe("Credentials need an https URL");
  expect(tokenProblem("https://ntfy.example.com/t?auth=abc", "")).toBe("");
});

test("a token with a space, a control character or non-ASCII is refused", () => {
  for (const t of ["tk abc", "tk\tabc", "tkあ"]) {
    expect(tokenProblem("https://ntfy.example.com/t", t)).toBe("The token must be printable ASCII without spaces");
  }
});

test("a token together with credentials in the URL is refused; an empty parameter is ignored", () => {
  const both = "Use either the token field or credentials in the URL, not both";
  expect(tokenProblem("https://ntfy.example.com/t?auth=abc", T)).toBe(both);
  expect(tokenProblem("https://ntfy.example.com/t?authorization=abc", T)).toBe(both);
  expect(tokenProblem("https://ntfy.example.com/t?auth=", T)).toBe("");
});

test("a repeated parameter with credentials after an empty one still counts", () => {
  expect(tokenProblem("http://ntfy.example.com/t?auth=&auth=abc", "")).toBe("Credentials need an https URL");
  expect(tokenProblem("http://ntfy.example.com/t?authorization=&authorization=abc", "")).toBe("Credentials need an https URL");
});

test("a policy URL wins and brings its own token, never the options page's", () => {
  const local = { ntfyUrl: "https://mine.example.com/t", ntfyToken: "tk_local" };
  expect(pickConfig({ ntfyUrl: "https://org.example.com/t", ntfyToken: "tk_org" }, local)).toEqual({
    ntfyUrl: "https://org.example.com/t",
    ntfyToken: "tk_org",
    managed: true,
  });
  expect(pickConfig({ ntfyUrl: "https://org.example.com/t" }, local)).toEqual({
    ntfyUrl: "https://org.example.com/t",
    ntfyToken: "",
    managed: true,
  });
});

test("without a policy URL the options page settings are used, even if a policy token exists", () => {
  const local = { ntfyUrl: "https://mine.example.com/t", ntfyToken: "tk_local" };
  expect(pickConfig({ ntfyToken: "tk_org" }, local)).toEqual({ ...local, managed: false });
  expect(pickConfig({}, {})).toEqual({ ntfyUrl: undefined, ntfyToken: "", managed: false });
});

test("user:pass@ in the URL is refused for every source of the URL", () => {
  expect(tokenProblem("https://u:p@ntfy.example.com/t", "")).toBe("Use an access token, or ?auth= in the URL, instead of user:pass@");
});

test("authParam is base64url of the whole header value, without padding", () => {
  // Standard base64 of "Bearer tk_%~7m?u4" is QmVhcmVyIHRrXyV+N20/dTQ= (has +, / and padding).
  expect(authParam("tk_%~7m?u4")).toBe("QmVhcmVyIHRrXyV-N20_dTQ");
});
