// Renders the Chrome Web Store screenshots (1280x800) of the options page with sample data:
//   bun scripts/store-screenshots.ts <output dir>
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const out = resolve(process.argv[2] ?? "store");
mkdirSync(out, { recursive: true });

const min = 60_000;
const now = Date.now();
const history = [
  { at: now - 3 * min, id: "kembcdlbgbcnnchcnbdhbmbhbejnedjf", name: "Tab Organizer", state: "sent",
    lines: ["version 2.4.1 -> 2.5.0", "permissions added: history", "warnings added: Read and change your browsing history on all your signed-in devices"] },
  { at: now - 42 * min, id: "dgldcbgpnkooljhfhcjpkojcdnfkepnb", name: "Reader Mode", state: "pending",
    lines: ["version 1.8.0 -> 1.9.0", "host permissions added: <all_urls>", "warnings added: Read and change all your data on all websites"] },
  { at: now - 5 * 60 * min, id: "ckklpoccipcbjojmlaolfdpbgjehmmpc", name: "Color Picker", state: "sent",
    lines: ["disabled (permissions_increase)"] },
  { at: now - 26 * 60 * min, id: "fomieninlmhecfehhapfijaenlkebomm", name: "Price Tracker", state: "sent",
    lines: ["installed 3.0.2 (normal)", "permissions: storage, alarms", "host permissions: https://*.example.com/*"] },
];

const tmp = mkdtempSync(join(tmpdir(), "extension-watch-shots-"));
const ext = resolve(import.meta.dir, "../extension");
let context;
try {
  context = await chromium.launchPersistentContext(join(tmp, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: ["--lang=en-US", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  // Let the first check write its baseline before the sample data replaces the history.
  for (let i = 0; !(await worker.evaluate(async () => !!(await chrome.storage.local.get("extensions")).extensions)); i++) {
    if (i > 100) throw new Error("the extension never wrote its first snapshot");
    await Bun.sleep(100);
  }
  // Saving the URL schedules a check 2 s later (SETTLE_MS in background.js); finding no change, it would mark
  // the sample "pending" entry "replaced". Write the history only after that check, since a history change
  // schedules nothing.
  await worker.evaluate(() => chrome.storage.local.set({ ntfyUrl: "https://ntfy.example.com/extension-watch", lastError: null }));
  await Bun.sleep(3000);
  await worker.evaluate((h) => chrome.storage.local.set({ history: h }), history);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForSelector('#state[data-state="watching"]');
  await page.screenshot({ path: join(out, "screenshot-settings.png") });

  await page.click("#tab-history");
  await page.waitForSelector("#panel-history:not([hidden])");
  await page.screenshot({ path: join(out, "screenshot-history.png") });
} finally {
  await context?.close();
  rmSync(tmp, { recursive: true, force: true });
}
