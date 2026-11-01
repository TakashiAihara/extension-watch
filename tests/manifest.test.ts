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
  expect(Object.keys(manifest.icons).sort()).toEqual(["128", "16", "32", "48"]);
  // Checked one map at a time so an entry in one cannot hide a wrong entry with the same key in the other.
  const entries = [...Object.entries(manifest.icons), ...Object.entries(manifest.action.default_icon)];
  for (const [size, path] of entries) {
    const png = readFileSync(join(import.meta.dir, "..", "extension", path));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // The PNG IHDR chunk holds width and height as big-endian 32-bit values at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Number(size), Number(size)]);
  }
});
