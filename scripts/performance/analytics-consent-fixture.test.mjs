import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as operator from "./analytics-consent-fixture.mjs";
import { verifyAnalyticsArtifact } from "./analytics-consent-fixture.mjs";
import { sinkReply } from "./analytics-consent-sink.mjs";

const cli = fileURLToPath(
	new URL("./analytics-consent-fixture.mjs", import.meta.url),
);
const run = (...args) =>
	new Promise((resolve) =>
		execFile(
			process.execPath,
			[cli, ...args],
			{ timeout: 5000 },
			(error, stdout, stderr) =>
				resolve({ code: error?.code ?? 0, stdout, stderr }),
		),
	);

test("operator launches standalone pnpm executables and script entry points correctly", async () => {
	assert.deepEqual(
		operator.pnpmInvocation(
			["run", "build"],
			"C:/tools/pnpm.exe",
			"C:/tools/node.exe",
		),
		{
			file: "C:/tools/pnpm.exe",
			args: ["--config.verifyDepsBeforeRun=false", "run", "build"],
		},
	);
	assert.deepEqual(
		operator.pnpmInvocation(["run", "build"], "/tools/pnpm.cjs", "/tools/node"),
		{
			file: "/tools/node",
			args: [
				"/tools/pnpm.cjs",
				"--config.verifyDepsBeforeRun=false",
				"run",
				"build",
			],
		},
	);
	const invocation = operator.pnpmInvocation(["--version"]);
	const version = await new Promise((resolve, reject) =>
		execFile(
			invocation.file,
			invocation.args,
			{ timeout: 5000 },
			(error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
		),
	);
	assert.match(version, /^\d+\.\d+\.\d+/);
});

test("operator refuses an external sink before creating a configured variant", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-consent-"));
	try {
		const input = join(directory, "input.json");
		await writeFile(
			input,
			JSON.stringify({
				origin: "http://localhost:50111",
				env: {
					APP_URL: "http://localhost:50111",
					NEXT_PUBLIC_APP_URL: "http://localhost:50111",
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_fixture",
					BETTER_AUTH_URL: "http://localhost:50111",
				},
			}),
		);
		const result = await run(
			"prepare",
			input,
			join(directory, "variant"),
			process.cwd(),
			"https://eu.i.posthog.com",
			"http://localhost:50112",
			"025336721",
		);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /loopback/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("verified artifact admits only the fixture token, original source hashes and exact complete rewrite set", async () => {
	const sourceCommit = "4d8bdb1d477cd02888565816b0fb96f85dc13b71";
	const directory = await mkdtemp(join(tmpdir(), "z8-consent-"));
	try {
		const app = join(directory, "app");
		const sourceHashes = {};
		const sources = [
			"src/components/posthog-provider.tsx",
			"next.config.ts",
			"node_modules/posthog-js/package.json",
			"node_modules/posthog-js/lib/src/remote-config.js",
			"node_modules/posthog-js/lib/src/feature-flags-config.js",
		];
		for (const file of sources) {
			await mkdir(join(app, file, ".."), { recursive: true });
			await writeFile(join(app, file), "synthetic source");
			sourceHashes[file] = createHash("sha256")
				.update("synthetic source")
				.digest("hex");
		}
		await mkdir(join(app, ".next/static/chunks"), { recursive: true });
		await writeFile(
			join(app, ".next/static/chunks/provider.js"),
			'"phc_z8_disposable_consent_1470_only"',
		);
		await writeFile(
			join(app, ".next/static/chunks/sdk.js"),
			'"__PosthogExtensions__"',
		);
		await writeFile(join(app, ".next/BUILD_ID"), "synthetic-build");
		await writeFile(
			join(app, ".next/required-server-files.json"),
			JSON.stringify({
				config: {
					deploymentId: sourceCommit,
					env: { NEXT_PUBLIC_BUILD_HASH: "4d8bdb1" },
				},
			}),
		);
		const rewrites = {
			beforeFiles: [],
			afterFiles: [
				{
					source: "/ingest/static/:path*",
					destination: "http://127.0.0.1:50113/static/:path*",
				},
				{
					source: "/ingest/:path*",
					destination: "http://127.0.0.1:50113/:path*",
				},
			],
			fallback: [],
		};
		await writeFile(
			join(app, ".next/routes-manifest.json"),
			JSON.stringify({ rewrites }),
		);
		const fixture = {
			kind: "disposable-consent-1470",
			version: 1,
			artifactApp: app,
			origin: "http://localhost:50112",
			sinkOrigin: "http://127.0.0.1:50113",
			sourceBuild: sourceCommit,
			sourceHashes,
			env: {
				APP_URL: "http://localhost:50112",
				BETTER_AUTH_URL: "http://localhost:50112",
				NEXT_PUBLIC_APP_URL: "http://localhost:50112",
				POSTGRES_HOST: "127.0.0.1",
				POSTGRES_DB: "approval_workflow_repository_test_fixture",
				NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
					"phc_z8_disposable_consent_1470_only",
				NEXT_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:50113",
				NEXT_DEPLOYMENT_ID: sourceCommit,
			},
		};
		await writeFile(
			join(directory, "analytics-private.json"),
			JSON.stringify(fixture),
		);
		assert.equal(
			(await verifyAnalyticsArtifact(directory)).report.tokenChunks,
			1,
		);
		await writeFile(
			join(app, ".next/required-server-files.json"),
			JSON.stringify({
				config: {
					deploymentId: "wrong-deployment-pin",
					env: { NEXT_PUBLIC_BUILD_HASH: "4d8bdb1" },
				},
			}),
		);
		await assert.rejects(
			verifyAnalyticsArtifact(directory),
			/Wrong compiled source build/,
		);
		await writeFile(
			join(app, ".next/required-server-files.json"),
			JSON.stringify({
				config: {
					deploymentId: sourceCommit,
					env: { NEXT_PUBLIC_BUILD_HASH: "wrong-public-hash" },
				},
			}),
		);
		await assert.rejects(
			verifyAnalyticsArtifact(directory),
			/Wrong compiled source build/,
		);
		await writeFile(
			join(app, ".next/required-server-files.json"),
			JSON.stringify({
				config: {
					deploymentId: sourceCommit,
					env: { NEXT_PUBLIC_BUILD_HASH: "4d8bdb1" },
				},
			}),
		);
		fixture.env.APP_URL = "https://production.example.test";
		await writeFile(
			join(directory, "analytics-private.json"),
			JSON.stringify(fixture),
		);
		await assert.rejects(verifyAnalyticsArtifact(directory), /Invalid fixture/);
		fixture.env.APP_URL = "http://localhost:50112";
		await writeFile(
			join(directory, "analytics-private.json"),
			JSON.stringify(fixture),
		);
		rewrites.beforeFiles.push({
			source: "/ingest/e/",
			destination: "https://eu.i.posthog.com/e/",
		});
		await writeFile(
			join(app, ".next/routes-manifest.json"),
			JSON.stringify({ rewrites }),
		);
		await assert.rejects(verifyAnalyticsArtifact(directory), /rewrite/);
		rewrites.beforeFiles = [];
		rewrites.beforeFiles.push({
			source: "/:path*",
			destination: "https://eu.i.posthog.com/:path*",
		});
		await writeFile(
			join(app, ".next/routes-manifest.json"),
			JSON.stringify({ rewrites }),
		);
		await assert.rejects(verifyAnalyticsArtifact(directory), /rewrite/);
		rewrites.beforeFiles = [];
		await writeFile(
			join(app, ".next/routes-manifest.json"),
			JSON.stringify({ rewrites }),
		);
		await writeFile(join(app, "next.config.ts"), "changed source");
		await assert.rejects(verifyAnalyticsArtifact(directory), /Source changed/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("sink has the installed SDK config/flags contract and discards unknown paths", () => {
	const config = sinkReply(
		"/array/phc_z8_disposable_consent_1470_only/config",
		"GET",
	);
	assert.equal(config.status, 200);
	assert.equal(JSON.parse(config.body).hasFeatureFlags, false);
	const flags = sinkReply("/flags/?v=2", "POST");
	assert.deepEqual(JSON.parse(flags.body).featureFlags, {});
	assert.equal(sinkReply("/static/recorder.js", "GET").status, 404);
	assert.equal(sinkReply("/array/phc_real_key/config", "GET").status, 404);
	assert.equal(sinkReply("/e/", "POST").bucket, "capture");
});

test("count-only sink never forwards a proxy request or treats it as local SDK capture", () => {
	assert.equal(sinkReply("https://eu.i.posthog.com/e/", "POST").status, 403);
	assert.equal(
		sinkReply("https://eu.i.posthog.com/e/", "POST").bucket,
		"blockedProxy",
	);
});

test("compiled rewrite gate catches server-side vendor delivery even when browser origins are local", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-consent-"));
	try {
		await mkdir(join(directory, "app", ".next"), { recursive: true });
		await writeFile(
			join(directory, "analytics-private.json"),
			JSON.stringify({
				kind: "disposable-consent-1470",
				version: 1,
				artifactApp: join(directory, "app"),
				origin: "http://localhost:50112",
				sinkOrigin: "http://127.0.0.1:50113",
				sourceBuild: "025336721",
				env: {
					APP_URL: "http://localhost:50112",
					BETTER_AUTH_URL: "http://localhost:50112",
					NEXT_PUBLIC_APP_URL: "http://localhost:50112",
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_fixture",
					NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
						"phc_z8_disposable_consent_1470_only",
					NEXT_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:50113",
				},
			}),
		);
		await writeFile(
			join(directory, "app", ".next", "routes-manifest.json"),
			JSON.stringify({
				rewrites: [
					{
						source: "/ingest/:path*",
						destination: "https://eu.i.posthog.com/:path*",
					},
				],
			}),
		);
		const result = await run("verify", directory);
		await assert.rejects(
			verifyAnalyticsArtifact(directory),
			/Unsafe compiled rewrite/,
		);
		assert.notEqual(result.code, 0);
		assert.match(result.stderr, /compiled.*rewrite/i);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
