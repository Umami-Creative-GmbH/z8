import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { collectTarget } from "./prepare-target-runtime.mjs";

test("root test script runs docker tracer tests", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );

  assert.match(packageJson.scripts.test, /docker\/scripts\/.+\.test\.mjs/);
});

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

test("collectTarget lists traced db-seed runtime files and packages", async () => {
  const result = await collectTarget("db-seed");

  assert.ok(Array.isArray(result.files));
  assert.ok(Array.isArray(result.packages));
  assert.ok(result.files.includes("src/db/seed/do-seed.ts"));
  assert.ok(result.files.includes("tsconfig.json"));
  assert.ok(result.packages.includes("dotenv"));
  assert.ok(result.packages.includes("pino"));
});
