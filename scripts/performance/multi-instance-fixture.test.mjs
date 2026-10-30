import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
	new URL("./multi-instance-fixture.mjs", import.meta.url),
);

for (const changed of ["manifest", "build-id"])
	test(`replica launch refuses a replaced ${changed} before starting an app or touching its collector`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "z8-multi-artifact-"));
		try {
			const app = join(directory, "app"),
				manifest = JSON.stringify({ config: { experimental: {} } });
			await mkdir(join(app, ".next"), { recursive: true });
			await writeFile(
				join(app, ".next/required-server-files.json"),
				changed === "manifest" ? JSON.stringify({ changed: true }) : manifest,
			);
			await writeFile(
				join(app, ".next/BUILD_ID"),
				changed === "build-id" ? "unexpected-build" : "frozen-build",
			);
			await writeFile(
				join(directory, "multi-private.json"),
				JSON.stringify({
					kind: "disposable-multi-instance-1472",
					version: 1,
					label: "z8-performance-multi-1472-example",
					origin: "http://localhost:50754",
					replicas: { a: { port: 50755 }, b: { port: 50756 } },
					env: {
						POSTGRES_HOST: "127.0.0.1",
						POSTGRES_DB: "approval_workflow_repository_test_multi_example",
					},
					containers: [],
					prepared: true,
					schemaMigration: { overlapIndexReady: true },
					artifactApp: app,
					artifactBuildId: "frozen-build",
					artifactManifestSha256: createHash("sha256")
						.update(manifest)
						.digest("hex"),
				}),
			);
			const result = spawnSync(
				process.execPath,
				[cli, "replica", directory, "a"],
				{ encoding: "utf8" },
			);
			assert.notEqual(result.status, 0);
			assert.match(
				await readFile(join(directory, "operator-error-private.log"), "utf8"),
				/Compiled artifact changed after fixture preparation/,
			);
			assert.equal(result.stdout, "");
		} finally {
			assert.equal(dirname(directory), resolve(tmpdir()));
			await rm(directory, { recursive: true, force: true });
		}
	});

test("operator plan records two private host replicas and the actual local proxy without publishing credentials", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-plan-"));
	try {
		await writeFile(
			join(directory, "multi-private.json"),
			JSON.stringify({
				kind: "disposable-multi-instance-1472",
				version: 1,
				origin: "http://localhost:50754",
				sourceBuild: "897b4077b",
				nextVersion: "16.4.3",
				artifactCopies: "per-replica",
				replicas: { a: { port: 50755 }, b: { port: 50756 } },
				env: {
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_multi_example",
					POSTGRES_PASSWORD: "never-publish-me",
				},
				label: "z8-performance-multi-1472-example",
				containers: [],
			}),
		);
		const result = spawnSync(process.execPath, [cli, "plan", directory], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const plan = JSON.parse(result.stdout);
		assert.equal(plan.webReplicas, 2);
		assert.equal(plan.proxy, "Docker HAProxy 2.8");
		assert.equal(plan.nextCache, "per-process default Cache Components memory");
		assert.equal(plan.productionTopologyVerified, false);
		assert.equal(plan.independentObserverCollectors, 2);
		assert.equal(plan.nativeProtocol, "z8-fixture-native-observer-v2");
		assert.equal(
			plan.migrationMethod,
			"normal migrate-with-lock.js on owned clone only",
		);
		assert.equal(result.stdout.includes("never-publish-me"), false);
		assert.equal(result.stdout.includes("POSTGRES_PASSWORD"), false);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

test("operator plan refuses a production origin before starting or querying services", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-reject-"));
	try {
		await writeFile(
			join(directory, "multi-private.json"),
			JSON.stringify({
				kind: "disposable-multi-instance-1472",
				version: 1,
				origin: "https://ui.z8-time.app",
				sourceBuild: "897b4077b",
				nextVersion: "16.4.3",
				replicas: { a: { port: 50755 }, b: { port: 50756 } },
				env: {
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_multi_example",
				},
				label: "z8-performance-multi-1472-example",
				containers: [],
			}),
		);
		const result = spawnSync(process.execPath, [cli, "plan", directory], {
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});
