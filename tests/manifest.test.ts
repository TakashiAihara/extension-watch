import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "../extension/manifest.json";
import schema from "../extension/schema.json";

test("the manifest declares the policy schema with both keys and a masked token", () => {
  expect(manifest.storage).toEqual({ managed_schema: "schema.json" });
  expect(Object.keys(schema.properties).sort()).toEqual(["ntfyToken", "ntfyUrl"]);
  expect(schema.properties.ntfyToken.sensitiveValue).toBe(true);
});

test("every icon the manifest names is a PNG of the declared size", () => {
  const all = { ...manifest.icons, ...manifest.action.default_icon };
  expect(Object.keys(manifest.icons).sort()).toEqual(["128", "16", "32", "48"]);
  for (const [size, path] of Object.entries(all)) {
    const png = readFileSync(join(import.meta.dir, "..", "extension", path));
    // The PNG IHDR chunk holds width and height as big-endian 32-bit values at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Number(size), Number(size)]);
  }
});
