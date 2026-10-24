import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
	new URL("./ingress-stream-probe.mjs", import.meta.url),
);
const source = "ba667c89f8c47634183518af5c02dd460892c930";

async function fixtureTest(run) {
	const directory = await mkdtemp(join(tmpdir(), "z8-ingress-plan-"));
	try {
		for (const [name, port] of [
			["a", 18101],
			["b", 18102],
		]) {
			const path = join(directory, `observer-${name}`);
			await mkdir(path);
			await writeFile(
				join(path, "native-control-private.json"),
				JSON.stringify({
					protocol: "z8-fixture-native-observer-v2",
					endpoint: `http://127.0.0.1:${port + 10}`,
				}),
			);
			await writeFile(
				join(path, "collector-control.json"),
				JSON.stringify({
					kind: "z8-fixture-otlp-collector-v2",
					endpoint: `http://127.0.0.1:${port}`,
					observerControl: join(path, "native-control-private.json"),
				}),
			);
		}
		await writeFile(
			join(directory, "multi-private.json"),
			JSON.stringify({
				kind: "disposable-multi-instance-1472",
				version: 1,
				label: "z8-performance-multi-1472-example",
				containers: [],
				origin: "http://localhost:50754",
				sourceBuild: source,
				nextVersion: "16.4.0",
				replicas: { a: { port: 50755 }, b: { port: 50756 } },
				env: {
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_multi_example",
					POSTGRES_PASSWORD: "never-expose-ingress-secret",
				},
			}),
		);
		await run(directory);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
}

test("operator can inspect a bounded local streaming plan without starting services or exposing secrets", () =>
	fixtureTest(async (directory) => {
		const result = spawnSync(
			process.execPath,
			[cli, "plan", directory, source],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const plan = JSON.parse(result.stdout);
		assert.equal(plan.holdTable, "shift");
		assert.equal(plan.maximumHoldMs, 12000);
		assert.equal(plan.proxy, "Docker HAProxy 2.8");
		assert.equal(plan.runtimeVerified, false);
		assert.equal(plan.productionTopologyVerified, false);
		assert.equal(plan.cdnVerified, false);
		assert.equal(result.stdout.includes("never-expose-ingress-secret"), false);
		assert.equal(result.stdout.includes("POSTGRES_PASSWORD"), false);
	}));

test("ingress refuses legacy single-collector coverage and shared per-replica controls before app IO", () =>
	fixtureTest(async (directory) => {
		const path = join(directory, "observer-b", "collector-control.json");
		const original = JSON.parse(await readFile(path, "utf8"));
		for (const value of [
			{ ...original, kind: "z8-fixture-otlp-collector-v1" },
			JSON.parse(
				await readFile(
					join(directory, "observer-a", "collector-control.json"),
					"utf8",
				),
			),
		]) {
			await writeFile(path, JSON.stringify(value));
			const result = spawnSync(
				process.execPath,
				[cli, "plan", directory, source],
				{ encoding: "utf8" },
			);
			assert.notEqual(result.status, 0);
			assert.equal(result.stdout, "");
		}
	}));

test("runtime command rejects a production origin without using its service credentials", () =>
	fixtureTest(async (directory) => {
		const path = join(directory, "multi-private.json");
		const manifest = JSON.parse(await readFile(path, "utf8"));
		manifest.origin = "https://ui.z8-time.app";
		await writeFile(path, JSON.stringify(manifest));
		const result = spawnSync(
			process.execPath,
			[cli, "run", directory, source, "desktop", "first-document", "held"],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.includes("never-expose-ingress-secret"), false);
	}));

test("operator refuses mismatched or pre-admission-repair artifacts before connecting to services", () =>
	fixtureTest(async (directory) => {
		for (const actual of ["897b4077b8d204990cc89124ad0adcd75ce95f27", source]) {
			const path = join(directory, "multi-private.json");
			const manifest = JSON.parse(await readFile(path, "utf8"));
			manifest.sourceBuild = actual;
			await writeFile(path, JSON.stringify(manifest));
			const requested =
				actual === source ? "897b4077b8d204990cc89124ad0adcd75ce95f27" : actual;
			const result = spawnSync(
				process.execPath,
				[cli, "plan", directory, requested],
				{ encoding: "utf8" },
			);
			assert.notEqual(result.status, 0);
			assert.equal(result.stdout, "");
			assert.equal(
				result.stderr.includes("never-expose-ingress-secret"),
				false,
			);
		}
	}));
