import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { collectTarget } from "./prepare-target-runtime.mjs";

const execFileAsync = promisify(execFile);

test("root test script runs docker tracer tests", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );

  assert.match(packageJson.scripts.test, /docker\/scripts\/.+\.test\.mjs/);
});

test("pnpm settings live in workspace config", async () => {
	const [packageJsonText, workspaceConfig] = await Promise.all([
		fs.readFile(new URL("../../package.json", import.meta.url), "utf8"),
		fs.readFile(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8"),
	]);
	const packageJson = JSON.parse(packageJsonText);

	assert.equal(packageJson.pnpm, undefined);
	assert.match(workspaceConfig, /^overrides:/m);
	assert.match(workspaceConfig, /^allowBuilds:/m);
});

test("collectTarget lists traced worker runtime files and packages", async () => {
	const result = await collectTarget("worker");

  assert.ok(Array.isArray(result.files));
  assert.ok(Array.isArray(result.packages));
  assert.ok(result.files.includes("src/worker.ts"));
	assert.ok(result.files.includes("tsconfig.json"));
	assert.ok(result.packages.includes("bullmq"));
	assert.ok(result.packages.includes("dotenv"));
	assert.ok(result.files.some((filePath) => filePath.endsWith(".tsx")));
	assert.ok(result.packages.includes("react"));
});

test("generated worker manifest includes React for TSX email templates", async () => {
	const packageJson = JSON.parse(
		await fs.readFile(new URL("../targets/worker/package.json", import.meta.url), "utf8"),
	);

	assert.equal(packageJson.dependencies.react, "19.2.6");
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

test("generated non-web manifests exclude obvious web-only type overrides", async () => {
  const manifestUrl = new URL("../targets/migration/package.json", import.meta.url);
  const originalManifest = await fs.readFile(manifestUrl, "utf8");

  let packageJson;
  try {
    await execFileAsync(process.execPath, ["docker/scripts/prepare-target-runtime.mjs", "manifest", "migration"], {
      cwd: new URL("../../", import.meta.url),
    });

    packageJson = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
  } finally {
    await fs.writeFile(manifestUrl, originalManifest);
  }

  assert.equal(packageJson.pnpm, undefined);

	const targetWorkspaceConfig = await fs.readFile(new URL("../targets/migration/pnpm-workspace.yaml", import.meta.url), "utf8");
	assert.doesNotMatch(targetWorkspaceConfig, /@types\/react:/);
	assert.doesNotMatch(targetWorkspaceConfig, /@types\/react-dom:/);
});

test("production worker and migration manifests use the trimmed runtime layout", async () => {
  const [workerManifest, migrationManifest] = await Promise.all([
    fs.readFile(new URL("../../infra/hetzner-k8s/k8s/app/worker-deployment.yaml", import.meta.url), "utf8"),
    fs.readFile(new URL("../../infra/hetzner-k8s/k8s/app/migration-job.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(workerManifest, /workingDir:\s+\/app\b/);
  assert.doesNotMatch(workerManifest, /workingDir:\s+\/app\/apps\/webapp\b/);

  assert.match(migrationManifest, /workingDir:\s+\/app\b/);
  assert.doesNotMatch(migrationManifest, /workingDir:\s+\/app\/apps\/webapp\b/);
});
