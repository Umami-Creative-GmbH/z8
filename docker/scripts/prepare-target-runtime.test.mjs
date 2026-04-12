import test from "node:test";
import assert from "node:assert/strict";

import { collectTarget } from "./prepare-target-runtime.mjs";

test("collectTarget lists traced worker runtime files and packages", async () => {
  const result = await collectTarget("worker");

  assert.ok(Array.isArray(result.files));
  assert.ok(Array.isArray(result.packages));
  assert.ok(result.files.includes("src/worker.ts"));
  assert.ok(result.files.includes("tsconfig.json"));
  assert.ok(result.packages.includes("bullmq"));
  assert.ok(result.packages.includes("dotenv"));
});

test("collectTarget lists traced migration runtime files and packages", async () => {
  const result = await collectTarget("migration");

  assert.ok(Array.isArray(result.files));
  assert.ok(Array.isArray(result.packages));
  assert.ok(result.files.includes("scripts/migrate-with-lock.js"));
  assert.ok(result.files.includes("drizzle.config.ts"));
  assert.ok(result.packages.includes("pg"));
});
