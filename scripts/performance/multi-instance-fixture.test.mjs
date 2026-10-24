import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
	new URL("./multi-instance-fixture.mjs", import.meta.url),
);

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
				nextVersion: "16.4.0",
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
				nextVersion: "16.4.0",
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
