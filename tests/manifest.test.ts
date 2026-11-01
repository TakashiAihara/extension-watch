import { expect, test } from "bun:test";
import manifest from "../extension/manifest.json";
import schema from "../extension/schema.json";

test("the manifest declares the policy schema with both keys and a masked token", () => {
  expect(manifest.storage).toEqual({ managed_schema: "schema.json" });
  expect(Object.keys(schema.properties).sort()).toEqual(["ntfyToken", "ntfyUrl"]);
  expect(schema.properties.ntfyToken.sensitiveValue).toBe(true);
});
