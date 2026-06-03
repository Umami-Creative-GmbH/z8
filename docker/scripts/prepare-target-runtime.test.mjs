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

test("Dockerfiles with global pnpm installs put pnpm global bin on PATH", async () => {
	const dockerfiles = [
		"Dockerfile.db-seed",
		"Dockerfile.docs",
		"Dockerfile.marketing",
		"Dockerfile.migration",
		"Dockerfile.webapp",
		"Dockerfile.worker",
	];

	for (const dockerfile of dockerfiles) {
		const contents = await fs.readFile(new URL(`../${dockerfile}`, import.meta.url), "utf8");

		if (!contents.includes("pnpm add -g")) {
			continue;
		}

		assert.match(
			contents,
			/ENV PATH=\$\{PNPM_HOME\}\/bin:\$\{PNPM_HOME\}:\$\{PATH\}/,
			`${dockerfile} must put pnpm global bin on PATH before pnpm add -g`,
		);
	}
});

test("non-root runtime Dockerfiles can run pnpm without writing root-owned Corepack or workspace paths", async () => {
	const dockerfiles = ["Dockerfile.docs", "Dockerfile.webapp"];

	for (const dockerfile of dockerfiles) {
		const contents = await fs.readFile(new URL(`../${dockerfile}`, import.meta.url), "utf8");

		assert.match(contents, /ENV COREPACK_HOME=\/corepack/, `${dockerfile} must use a shared Corepack cache`);
		assert.match(
			contents,
			/RUN mkdir -p "\$\{PNPM_HOME\}" "\$\{COREPACK_HOME\}"/,
			`${dockerfile} must create the shared Corepack cache before corepack prepare`,
		);
		assert.match(
			contents,
			/RUN chown [^\n]+ \/app \/corepack/,
			`${dockerfile} must make the workspace root and Corepack cache writable for its runtime user`,
		);
	}
});

test("Next.js runtime Dockerfiles start without pnpm dependency status checks", async () => {
	const dockerfiles = ["Dockerfile.docs", "Dockerfile.webapp"];

	for (const dockerfile of dockerfiles) {
		const contents = await fs.readFile(new URL(`../${dockerfile}`, import.meta.url), "utf8");

		assert.doesNotMatch(
			contents,
			/CMD \["pnpm", "start"\]/,
			`${dockerfile} must not invoke pnpm at runtime because pnpm may try to repair node_modules without a TTY`,
		);
	}
});

test("docs runtime Dockerfile starts Next.js on the Kubernetes service port", async () => {
	const contents = await fs.readFile(new URL("../Dockerfile.docs", import.meta.url), "utf8");

	assert.match(contents, /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start", "-p", "3001"\]/);
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

	assert.ok(packageJson.dependencies.react);
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
	assert.match(targetWorkspaceConfig, /^minimumReleaseAgeExclude:/m);
	assert.doesNotMatch(targetWorkspaceConfig, /@types\/react:/);
	assert.doesNotMatch(targetWorkspaceConfig, /@types\/react-dom:/);
});

test("target manifest check fails when generated dependencies drift", async () => {
	const manifestUrl = new URL("../targets/migration/package.json", import.meta.url);
	const originalManifest = await fs.readFile(manifestUrl, "utf8");
	const staleManifest = JSON.parse(originalManifest);
	delete staleManifest.dependencies.luxon;

	try {
		await fs.writeFile(manifestUrl, `${JSON.stringify(staleManifest, null, 2)}\n`);
		await assert.rejects(
			execFileAsync(process.execPath, ["docker/scripts/prepare-target-runtime.mjs", "check", "migration"], {
				cwd: new URL("../../", import.meta.url),
			}),
			(error) => {
				assert.match(`${error.stderr}${error.stdout}${error.message}`, /docker\/targets\/migration\/package\.json/);
				assert.match(`${error.stderr}${error.stdout}${error.message}`, /pnpm docker:sync:non-web-targets/);
				return true;
			},
		);
	} finally {
		await fs.writeFile(manifestUrl, originalManifest);
	}
});

test("target manifest check passes for committed generated manifests", async () => {
	await execFileAsync(
		process.execPath,
		["docker/scripts/prepare-target-runtime.mjs", "check", "worker", "migration", "db-seed"],
		{
			cwd: new URL("../../", import.meta.url),
		},
	);
});

test("copied migration runtime includes pnpm workspace config for frozen installs", async () => {
	const outputUrl = new URL("../targets/.tmp-migration-runtime/", import.meta.url);

	try {
		await execFileAsync(process.execPath, [
			"docker/scripts/prepare-target-runtime.mjs",
			"copy",
			"migration",
			new URL(".", outputUrl).pathname,
		], {
			cwd: new URL("../../", import.meta.url),
		});

		const workspaceConfig = await fs.readFile(new URL("pnpm-workspace.yaml", outputUrl), "utf8");
		assert.match(workspaceConfig, /^minimumReleaseAgeExclude:/m);
		assert.match(workspaceConfig, /^overrides:/m);
		assert.match(workspaceConfig, /"postcss":/);
	} finally {
		await fs.rm(outputUrl, { recursive: true, force: true });
	}
});

test("trimmed runtime Dockerfiles copy pnpm workspace config before install", async () => {
	const dockerfiles = ["Dockerfile.db-seed", "Dockerfile.migration", "Dockerfile.worker"];

	for (const dockerfile of dockerfiles) {
		const contents = await fs.readFile(new URL(`../${dockerfile}`, import.meta.url), "utf8");
		const workspaceCopyIndex = contents.indexOf("/runtime/pnpm-workspace.yaml");
		const installIndex = contents.indexOf("pnpm install --prod --frozen-lockfile");

		assert.notEqual(workspaceCopyIndex, -1, `${dockerfile} must copy pnpm-workspace.yaml`);
		assert.notEqual(installIndex, -1, `${dockerfile} must run a frozen production install`);
		assert.ok(workspaceCopyIndex < installIndex, `${dockerfile} must copy pnpm-workspace.yaml before install`);
	}
});

test("trimmed runtime Dockerfiles allow pnpm to read workspace overrides", async () => {
	const dockerfiles = ["Dockerfile.db-seed", "Dockerfile.migration", "Dockerfile.worker"];

	for (const dockerfile of dockerfiles) {
		const contents = await fs.readFile(new URL(`../${dockerfile}`, import.meta.url), "utf8");
		assert.doesNotMatch(
			contents,
			/pnpm install --prod --frozen-lockfile --ignore-workspace/,
			`${dockerfile} must not ignore the generated pnpm-workspace.yaml during frozen install`,
		);
	}
});

test("production worker and migration manifests use the trimmed runtime layout", async () => {
  const [workerManifest, migrationManifest] = await Promise.all([
    fs.readFile(new URL("../../deploy/k8s/worker.yaml", import.meta.url), "utf8"),
    fs.readFile(new URL("../../deploy/k8s/migration.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(workerManifest, /workingDir:\s+\/app\b/);
  assert.doesNotMatch(workerManifest, /workingDir:\s+\/app\/apps\/webapp\b/);

  assert.match(migrationManifest, /workingDir:\s+\/app\b/);
  assert.doesNotMatch(migrationManifest, /workingDir:\s+\/app\/apps\/webapp\b/);
});
