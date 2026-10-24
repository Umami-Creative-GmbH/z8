import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
	new URL("./multi-instance-suite.mjs", import.meta.url),
);
const head = spawnSync("git", ["rev-parse", "HEAD"], {
	encoding: "utf8",
}).stdout.trim();
async function fixture(run) {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-suite-"));
	try {
		for (const [name, port] of [
			["a", 18101],
			["b", 18102],
		]) {
			const observer = join(directory, `observer-${name}`);
			await mkdir(observer);
			await writeFile(
				join(observer, "native-control-private.json"),
				JSON.stringify({
					protocol: "z8-fixture-native-observer-v2",
					endpoint: `http://127.0.0.1:${port + 10}`,
				}),
			);
			await writeFile(
				join(observer, "collector-control.json"),
				JSON.stringify({
					kind: "z8-fixture-otlp-collector-v2",
					endpoint: `http://127.0.0.1:${port}`,
					observerControl: join(observer, "native-control-private.json"),
				}),
			);
		}
		await writeFile(
			join(directory, "multi-private.json"),
			JSON.stringify({
				kind: "disposable-multi-instance-1472",
				version: 1,
				origin: "http://localhost:50754",
				sourceBuild: head,
				replicas: { a: { port: 50755 }, b: { port: 50756 } },
				label: "z8-performance-multi-1472-example",
				containers: [],
				env: {
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_multi_example",
					POSTGRES_PASSWORD: "private-password",
				},
			}),
		);
		await run(directory);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
}
test("finite multi-instance acceptance plan declares two computations maximum and real caller gates without contacting services", () =>
	fixture(async (directory) => {
		const result = spawnSync(process.execPath, [cli, "plan", directory, head], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const plan = JSON.parse(result.stdout);
		assert.deepEqual(plan.readers, ["work", "team", "overtime"]);
		assert.equal(plan.concurrentRequestsPerReplica, 8);
		assert.equal(plan.maximumConcurrentComputations, 2);
		assert.equal(plan.expiryWaitMs, 62000);
		assert.equal(plan.runtimeVerified, false);
		assert.equal(plan.independentCollectors, 2);
		assert.equal(plan.observation, "paired-native-observer-v2");
		assert.equal(plan.transport, "context-loopback-proxy-v1");
		assert.equal(result.stdout.includes("private-password"), false);
	}));
test("suite rejects a different source pin before opening the browser or database", () =>
	fixture(async (directory) => {
		const result = spawnSync(
			process.execPath,
			[cli, "plan", directory, "897b4077b"],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.includes("private-password"), false);
	}));

test("suite rejects the old artifact even when its pin matches, before using service credentials", () =>
	fixture(async (directory) => {
		const path = join(directory, "multi-private.json");
		const value = JSON.parse(await readFile(path, "utf8"));
		value.sourceBuild = "897b4077b";
		await writeFile(path, JSON.stringify(value));
		const result = spawnSync(
			process.execPath,
			[cli, "plan", directory, value.sourceBuild],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.includes("private-password"), false);
	}));
