import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, run } from "../src/watch";
import { ext, writeProfile } from "./fixture";

const received: string[] = [];
const auth: (string | null)[] = [];
let status = 200;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    if (status !== 200) return new Response("", { status });
    auth.push(req.headers.get("authorization"));
    received.push(await req.text());
    return new Response("{}");
  },
});
afterAll(() => server.stop(true));

let dir: string;
let env: { [k: string]: string };
const chrome = () => join(dir, "chrome");
const writeConfig = (config: object) => {
  mkdirSync(join(dir, "config", "extension-watch"), { recursive: true });
  writeFileSync(join(dir, "config", "extension-watch", "config.json"), JSON.stringify(config));
};

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "ew-watch-"));
  env = { HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") };
  received.length = 0;
  auth.length = 0;
  status = 200;
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: chrome() });
  writeProfile(chrome(), "Default", { abc: ext() });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("default paths per platform", () => {
  expect(paths({ APPDATA: "C:\\R", LOCALAPPDATA: "C:\\L" }, "win32")).toEqual({
    config: join("C:\\R", "extension-watch", "config.json"),
    state: join("C:\\L", "extension-watch", "state.json"),
    chrome: join("C:\\L", "Google", "Chrome", "User Data"),
  });
  expect(paths({ HOME: "/h" }, "darwin").chrome).toBe("/h/Library/Application Support/Google/Chrome");
  expect(paths({ HOME: "/h" }, "linux")).toEqual({
    config: "/h/.config/extension-watch/config.json",
    state: "/h/.local/state/extension-watch/state.json",
    chrome: "/h/.config/google-chrome",
  });
});

test("first run takes a baseline and sends nothing", async () => {
  expect(await run(env, "linux")).toBe(0);
  expect(received).toEqual([]);
  expect(Object.keys(JSON.parse(readFileSync(join(dir, "state", "extension-watch", "state.json"), "utf8")))).toEqual(["Default/abc"]);
});

test("a change is sent once", async () => {
  await run(env, "linux");
  writeProfile(chrome(), "Default", { abc: ext({ manifest: { name: "Sample", version: "1.1" } }) });
  expect(await run(env, "linux")).toBe(0);
  expect(await run(env, "linux")).toBe(0);
  expect(received).toEqual(["Sample (abc) [Default]\nversion 1.0 -> 1.1"]);
});

test("a rejected send is sent again on the next run", async () => {
  await run(env, "linux");
  writeProfile(chrome(), "Default", { abc: ext({ manifest: { name: "Sample", version: "1.1" } }) });
  status = 500;
  expect(await run(env, "linux")).toBe(1);
  status = 200;
  expect(await run(env, "linux")).toBe(0);
  expect(received).toEqual(["Sample (abc) [Default]\nversion 1.0 -> 1.1"]);
});

test("a new extension whose send fails is reported as new on the next run", async () => {
  await run(env, "linux");
  writeProfile(chrome(), "Default", { abc: ext(), def: ext({ manifest: { name: "New", version: "3" } }) });
  status = 500;
  expect(await run(env, "linux")).toBe(1);
  status = 200;
  expect(await run(env, "linux")).toBe(0);
  expect(received).toEqual(["New (def) [Default]\ninstalled 3 (internal)\npermissions: storage"]);
});

test("a long message is split into parts within ntfy's limit", async () => {
  await run(env, "linux");
  const hosts = Array.from({ length: 300 }, (_, i) => `https://host-${i}.example/*`);
  writeProfile(chrome(), "Default", { abc: ext({ active_permissions: { api: ["storage"], explicit_host: hosts } }) });
  expect(await run(env, "linux")).toBe(0);
  expect(received.length).toBeGreaterThan(1);
  expect(received[0]).toStartWith(`(1/${received.length}) Sample (abc) [Default]`);
  for (const r of received) expect(new TextEncoder().encode(r).length).toBeLessThanOrEqual(4096);
  const joined = received.map((r, i) => r.slice(`(${i + 1}/${received.length}) `.length)).join("");
  expect(joined).toBe(`Sample (abc) [Default]\nhosts added: ${[...hosts].sort().join(", ")}`);
});

test("the token is sent as a bearer header, and no header without one", async () => {
  await run(env, "linux");
  writeProfile(chrome(), "Default", { abc: ext({ manifest: { name: "Sample", version: "1.1" } }) });
  expect(await run(env, "linux")).toBe(0);
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, ntfyToken: " tk_abc\n", chromeUserDataDir: chrome() });
  writeProfile(chrome(), "Default", { abc: ext({ manifest: { name: "Sample", version: "1.2" } }) });
  expect(await run(env, "linux")).toBe(0);
  expect(auth).toEqual([null, "Bearer tk_abc"]);
});

test("a token a header cannot hold fails without sending", async () => {
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, ntfyToken: "tk a", chromeUserDataDir: chrome() });
  expect(await run(env, "linux")).toBe(1);
  expect(received).toEqual([]);
});

test("missing config fails without sending", async () => {
  rmSync(join(dir, "config"), { recursive: true });
  expect(await run(env, "linux")).toBe(1);
  expect(received).toEqual([]);
});

test("unreadable Chrome data is sent as an error", async () => {
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: join(dir, "nowhere") });
  expect(await run(env, "linux")).toBe(1);
  expect(received.length).toBe(1);
  expect(received[0]).toStartWith("cannot read Chrome extensions: ENOENT");
});

test("a profile with no extensions is a valid baseline", async () => {
  writeProfile(chrome(), "Default", {});
  expect(await run(env, "linux")).toBe(0);
  writeProfile(chrome(), "Default", { abc: ext() });
  expect(await run(env, "linux")).toBe(0);
  expect(received).toEqual(["Sample (abc) [Default]\ninstalled 1.0 (internal)\npermissions: storage"]);
});

test("a lasting error is sent once, and again after a clean run", async () => {
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: join(dir, "nowhere") });
  expect(await run(env, "linux")).toBe(1);
  expect(await run(env, "linux")).toBe(1);
  expect(received.length).toBe(1);
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: chrome() });
  expect(await run(env, "linux")).toBe(0);
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: join(dir, "nowhere") });
  expect(await run(env, "linux")).toBe(1);
  expect(received.length).toBe(2);
});

test("an error that could not be sent is sent on the next run", async () => {
  writeConfig({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: join(dir, "nowhere") });
  status = 500;
  expect(await run(env, "linux")).toBe(1);
  status = 200;
  expect(await run(env, "linux")).toBe(1);
  expect(received.length).toBe(1);
});

test("a profile that cannot be read keeps its records and the others are compared", async () => {
  writeProfile(chrome(), "Profile 2", { def: ext({ manifest: { name: "Other", version: "1" } }) });
  await run(env, "linux");
  writeProfile(chrome(), "Default", { abc: ext({ manifest: { name: "Sample", version: "1.1" } }) });
  writeFileSync(join(chrome(), "Profile 2", "Secure Preferences"), "{broken");
  expect(await run(env, "linux")).toBe(1);
  expect(received[0]).toBe("Sample (abc) [Default]\nversion 1.0 -> 1.1");
  expect(received[1]).toStartWith("cannot read Chrome profile Profile 2: ");
  writeProfile(chrome(), "Profile 2", { def: ext({ manifest: { name: "Other", version: "1" } }) });
  expect(await run(env, "linux")).toBe(0);
  expect(received.length).toBe(2);
});

test("a state file of the wrong shape is sent as an error", async () => {
  await run(env, "linux");
  writeFileSync(join(dir, "state", "extension-watch", "state.json"), JSON.stringify({ x: { permissions: [] } }));
  expect(await run(env, "linux")).toBe(1);
  expect(received[0]).toEndWith("state.json: unexpected shape");
});

test("a corrupt state file is sent as an error", async () => {
  await run(env, "linux");
  writeFileSync(join(dir, "state", "extension-watch", "state.json"), "{broken");
  expect(await run(env, "linux")).toBe(1);
  expect(received.length).toBe(1);
  expect(received[0]).toStartWith(`cannot read ${join(dir, "state", "extension-watch", "state.json")}: `);
});
