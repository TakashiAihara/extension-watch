import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { run } from "../src/watch";

// Loads an unpacked extension into a real Chrome for Testing profile, closes Chrome so the
// profile is flushed, and runs the watcher against that profile.
const received: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    received.push(await req.text());
    return new Response("{}");
  },
});

const dir = mkdtempSync(join(tmpdir(), "ew-e2e-"));
const target = join(dir, "target");
const userData = join(dir, "chrome");
const env = { HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") };
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const writeTarget = (version: string, permissions: string[], content_scripts?: object[]) =>
  writeFileSync(join(target, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Target", version, permissions, content_scripts }));

async function openAndClose() {
  const ctx = await chromium.launchPersistentContext(userData, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${target}`, `--load-extension=${target}`],
  });
  await Bun.sleep(1500);
  await ctx.close();
}

test("an update that adds a permission and an all-sites content script is sent", async () => {
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "cs.js"), "");
  writeTarget("1.0", ["storage"]);
  mkdirSync(join(dir, "config", "extension-watch"), { recursive: true });
  writeFileSync(
    join(dir, "config", "extension-watch", "config.json"),
    JSON.stringify({ ntfyUrl: `http://127.0.0.1:${server.port}/topic`, chromeUserDataDir: userData }),
  );

  await openAndClose();
  expect(await run(env, "linux")).toBe(0);
  expect(received).toEqual([]);

  writeTarget("1.1", ["storage", "tabs"], [{ matches: ["<all_urls>"], js: ["cs.js"] }]);
  await openAndClose();
  expect(await run(env, "linux")).toBe(0);
  expect(received.length).toBe(1);
  expect(received[0]).toMatch(
    /^Target \([a-p]{32}\) \[Default\]\nversion 1\.0 -> 1\.1\npermissions added: tabs\ncontent script sites added: <all_urls>$/,
  );
}, 60000);
