import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { checkTargetPackage, collectTarget } from "./prepare-target-runtime.mjs";

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

test("SCIM uses the upstream Better Auth release without a local patch", async () => {
	const [workspaceConfig, webappPackageJsonText] = await Promise.all([
		fs.readFile(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8"),
		fs.readFile(new URL("../../apps/webapp/package.json", import.meta.url), "utf8"),
	]);
	const webappPackageJson = JSON.parse(webappPackageJsonText);

	assert.doesNotMatch(workspaceConfig, /@better-auth\/scim@.*\.patch/);
	for (const dependency of [
		"better-auth",
		"@better-auth/api-key",
		"@better-auth/drizzle-adapter",
		"@better-auth/passkey",
		"@better-auth/scim",
		"@better-auth/sso",
	]) {
		assert.equal(webappPackageJson.dependencies[dependency], "1.7.2");
	}
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

test("Dockerfiles install pnpm without relying on Corepack", async () => {
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

		assert.doesNotMatch(contents, /\bcorepack\b/, `${dockerfile} must not depend on Corepack being present in the base image`);
		assert.match(contents, /npm install --global pnpm@\$\{PNPM_VERSION\}/, `${dockerfile} must install the pinned pnpm version through npm`);
	}
});

test("Dockerfiles pin the workspace pnpm version", async () => {
	const packageJson = JSON.parse(
		await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"),
	);
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
		assert.match(
			contents,
			new RegExp(`^ARG PNPM_VERSION=${packageJson.packageManager.slice("pnpm@".length)}$`, "m"),
			`${dockerfile} must pin the workspace pnpm version`,
		);
	}
});

test("non-root runtime Dockerfiles can run without root-owned pnpm or workspace paths", async () => {
	const dockerfiles = ["Dockerfile.docs", "Dockerfile.webapp"];

	for (const dockerfile of dockerfiles) {
		const contents = await fs.readFile(new URL(`../${dockerfile}`, import.meta.url), "utf8");

		assert.match(contents, /RUN mkdir -p "\$\{PNPM_HOME\}"/, `${dockerfile} must create the pnpm home path`);
		assert.match(
			contents,
			/(?:^|\n)\s*(?:RUN\s+)?chown(?:\s+-\S+)* [^\n]+ \/app \/pnpm/m,
			`${dockerfile} must make the workspace root and pnpm home writable for its runtime user`,
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

test("font size preferences provide a static server snapshot", async () => {
  const contents = await fs.readFile(
    new URL("../../apps/webapp/src/components/font-size-preference.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    contents,
    /(?:function\s+getServerFontSizePreference\s*\([^)]*\)(?:\s*:\s*[^{}=]+)?|(?:const|let|var)\s+getServerFontSizePreference\s*=\s*\([^)]*\)(?:\s*:\s*[^{}=]+)?\s*=>)\s*\{\s*return "default";\s*\}/s,
  );
  assert.match(
    contents,
    /useSyncExternalStore\(\s*[^,]+\s*,\s*[^,]+\s*,\s*getServerFontSizePreference\s*,?\s*\)/s,
  );
});

test("docs runtime Dockerfile starts Next.js on the Kubernetes service port", async () => {
	const contents = await fs.readFile(new URL("../Dockerfile.docs", import.meta.url), "utf8");

	assert.match(contents, /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start", "-p", "3001"\]/);
});

test("docs uses TypeScript 7 supported by its Next.js build", async () => {
	const packageJson = JSON.parse(
		await fs.readFile(new URL("../../apps/docs/package.json", import.meta.url), "utf8"),
	);

	assert.ok(
		Number.parseInt(packageJson.devDependencies.typescript.replace(/^[~^]/, ""), 10) >= 7,
		"Next.js 16.3 supports TypeScript 7",
	);
});

test("marketing and webapp use TypeScript 7 supported by their Next.js builds", async () => {
	for (const app of ["marketing", "webapp"]) {
		const packageJson = JSON.parse(
			await fs.readFile(new URL(`../../apps/${app}/package.json`, import.meta.url), "utf8"),
		);
		const typescript = packageJson.dependencies.typescript ?? packageJson.devDependencies.typescript;

		assert.ok(
			Number.parseInt(typescript.replace(/^[~^]/, ""), 10) >= 7,
			`${app} must use TypeScript 7 with Next.js 16.3`,
		);
	}
});

test("app Biome configurations extend the repository project", async () => {
	for (const app of ["marketing", "webapp"]) {
		const config = JSON.parse(
			await fs.readFile(new URL(`../../apps/${app}/biome.jsonc`, import.meta.url), "utf8"),
		);

		assert.equal(config.root, false, `${app} Biome configuration must not define a nested root`);
	}
});

test("collectTarget lists traced worker runtime files and packages", async () => {
	const result = await collectTarget("worker");

  assert.ok(Array.isArray(result.files));
  assert.ok(Array.isArray(result.packages));
  assert.ok(result.files.includes("src/worker.ts"));
	assert.ok(result.files.includes("scripts/obliterate-job-queue.ts"));
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

test("generated worker manifest uses the webapp temporal-polyfill version", async () => {
	const [webappPackageJsonText, packageJsonText, lockfile] = await Promise.all([
		fs.readFile(new URL("../../apps/webapp/package.json", import.meta.url), "utf8"),
		fs.readFile(new URL("../targets/worker/package.json", import.meta.url), "utf8"),
		fs.readFile(new URL("../targets/worker/pnpm-lock.yaml", import.meta.url), "utf8"),
	]);
	const webappPackageJson = JSON.parse(webappPackageJsonText);
	const packageJson = JSON.parse(packageJsonText);
	const temporalPolyfillVersion = webappPackageJson.dependencies["temporal-polyfill"];

	assert.equal(packageJson.type, "module");
	assert.equal(packageJson.dependencies["temporal-polyfill"], temporalPolyfillVersion);
	assert.ok(lockfile.includes(`temporal-polyfill@${temporalPolyfillVersion}:`));
	assert.doesNotMatch(packageJsonText, /@js-temporal\/polyfill/);
	assert.doesNotMatch(lockfile, /@js-temporal\/polyfill/);
});

test("generated migrated runtime manifests exclude the champion polyfill", async () => {
	const targets = ["worker", "migration", "db-seed"];

	for (const target of targets) {
		const [packageJsonText, lockfile] = await Promise.all([
			fs.readFile(new URL(`../targets/${target}/package.json`, import.meta.url), "utf8"),
			fs.readFile(new URL(`../targets/${target}/pnpm-lock.yaml`, import.meta.url), "utf8"),
		]);

		assert.doesNotMatch(packageJsonText, /@js-temporal\/polyfill/);
		assert.doesNotMatch(lockfile, /@js-temporal\/polyfill/);
	}
});

test("generated schema-only runtimes exclude untraced Temporal packages", async () => {
	for (const target of ["migration", "db-seed"]) {
		const [packageJsonText, lockfile] = await Promise.all([
			fs.readFile(new URL(`../targets/${target}/package.json`, import.meta.url), "utf8"),
			fs.readFile(new URL(`../targets/${target}/pnpm-lock.yaml`, import.meta.url), "utf8"),
		]);
		const packageJson = JSON.parse(packageJsonText);

		assert.equal(
			packageJson.type,
			"module",
			`${target} must execute traced TypeScript as ESM for import-only packages`,
		);
		assert.equal(packageJson.dependencies["temporal-polyfill"], undefined);
		assert.doesNotMatch(lockfile, /temporal-polyfill@/);
		assert.doesNotMatch(packageJsonText, /@js-temporal\/polyfill/);
		assert.doesNotMatch(lockfile, /@js-temporal\/polyfill/);
	}
});

test("migration runner uses ESM syntax required by its runtime manifest", async () => {
	const runner = await fs.readFile(
		new URL("../../apps/webapp/scripts/migrate-with-lock.js", import.meta.url),
		"utf8",
	);

	assert.match(runner, /import \{ spawnSync \} from "node:child_process";/);
	assert.match(runner, /import \{ readFileSync \} from "node:fs";/);
	assert.match(runner, /import \{ Client \} from "pg";/);
	assert.doesNotMatch(runner, /\brequire\s*\(/);
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
			checkTargetPackage("migration"),
			(error) => {
				assert.match(error.message, /docker\/targets\/migration\/package\.json/);
				assert.match(error.message, /pnpm docker:sync:non-web-targets/);
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

test("Kustomize never applies placeholder authentication secrets", async () => {
	const [kustomization, secretTemplate] = await Promise.all([
		fs.readFile(new URL("../../deploy/k8s/kustomization.yaml", import.meta.url), "utf8"),
		fs.readFile(new URL("../../deploy/k8s/secret.yaml", import.meta.url), "utf8"),
	]);

	assert.doesNotMatch(kustomization, /^\s*-\s+secret\.yaml\s*$/m);
	assert.match(secretTemplate, /^\s+auth-secret:/m);
	assert.match(secretTemplate, /^\s+scim-credential-hash-secret:/m);
});
