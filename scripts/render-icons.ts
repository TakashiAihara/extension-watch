// Renders extension/icons/icon.svg to the PNG sizes the manifest and the Chrome Web Store need.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = join(import.meta.dir, "..", "extension", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
