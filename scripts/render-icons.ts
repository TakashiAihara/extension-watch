// Renders extension/icons/icon.svg to the PNG sizes the manifest and the Chrome Web Store need.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const dir = join(import.meta.dir, "..", "extension", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch();
// The Chrome Web Store asks for the 128 px icon to be 96 px of artwork inside 16 px of transparent padding.
const padding: Record<number, number> = { 16: 0, 32: 0, 48: 0, 128: 16 };
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const art = size - 2 * padding[size];
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${art}px;height:${art}px;margin:${padding[size]}px}</style>${svg}`);
    await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
