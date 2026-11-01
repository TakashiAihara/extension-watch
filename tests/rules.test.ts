import { expect, test } from "bun:test";
import { tokenProblem } from "../extension/rules.js";

test("no token is always fine", () => {
  expect(tokenProblem("http://ntfy.example.com/t", "")).toBe("");
});

test("an https URL with a plain token is fine, and loopback http is allowed", () => {
  expect(tokenProblem("https://ntfy.example.com/t", "tk_abc123")).toBe("");
  expect(tokenProblem("http://127.0.0.1:8080/t", "tk_abc123")).toBe("");
  expect(tokenProblem("http://localhost/t", "tk_abc123")).toBe("");
  expect(tokenProblem("http://[::1]/t", "tk_abc123")).toBe("");
});

test("a token is refused over http to another host", () => {
  expect(tokenProblem("http://ntfy.example.com/t", "tk_abc123")).toBe("A token needs an https URL");
});

test("a token with a space, a control character or non-ASCII is refused", () => {
  for (const t of ["tk abc", "tk\tabc", "tkあ"]) {
    expect(tokenProblem("https://ntfy.example.com/t", t)).toBe("The token must be printable ASCII without spaces");
  }
});

test("a token together with ?auth= is refused", () => {
  expect(tokenProblem("https://ntfy.example.com/t?auth=abc", "tk_abc123")).toBe(
    "Use either the token field or ?auth= in the URL, not both",
  );
});
