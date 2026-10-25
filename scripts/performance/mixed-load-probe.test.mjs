import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as mixedProbe from "./mixed-load-probe.mjs";

test("mixed source identity accepts the API seven-character hash only as a prefix of the recorded source", () => {
	const source = "456d28b2da4437662ae8f625a1df6756bff031fe";
	assert.equal(typeof mixedProbe.mixedSourceMatches, "function");
	for (const size of [7, 9, 40])
		assert.equal(
			mixedProbe.mixedSourceMatches(source, source.slice(0, size)),
			true,
		);
	assert.equal(
		mixedProbe.mixedSourceMatches(
			"de0b1a128b384196c7c93ac69cd5324e8d0cbbd8",
			"de0b1a1",
		),
		true,
	);
	assert.equal(
		mixedProbe.mixedSourceMatches(source.slice(0, 9), source.slice(0, 7)),
		true,
	);
});

test("mixed source identity rejects mismatches, malformed hashes and a live hash longer than its pin", () => {
	const source = "456d28b2da4437662ae8f625a1df6756bff031fe";
	assert.equal(typeof mixedProbe.mixedSourceMatches, "function");
	for (const observed of [
		"456d28",
		"456d28b-extra",
		"development",
		"DE0B1A1",
		"de0b1a1",
		`${source}0`,
		null,
		456,
	])
		assert.equal(mixedProbe.mixedSourceMatches(source, observed), false);
	for (const pin of [
		source.slice(0, 7),
		`${source}0`,
		"development",
		null,
		456,
	])
		assert.equal(mixedProbe.mixedSourceMatches(pin, source.slice(0, 7)), false);
	assert.equal(
		mixedProbe.mixedSourceMatches(source.slice(0, 9), source),
		false,
	);
});

const cli = fileURLToPath(new URL("./mixed-load-probe.mjs", import.meta.url));
async function seedPlan(directory, origin = "http://localhost:34123") {
	await writeFile(
		join(directory, "runtime-private.json"),
		JSON.stringify({
			origin,
			env: {
				POSTGRES_DB: "approval_workflow_repository_test_mixed",
				POSTGRES_POOL_MAX: "10",
				POSTGRES_PASSWORD: "never-publish-me",
			},
		}),
	);
	await writeFile(
		join(directory, "fixture-private.json"),
		JSON.stringify({
			kind: "disposable",
			actors: Object.fromEntries(
				["large-admin", "small-admin", "small-manager", "large-manager"].map(
					(name) => [
						name,
						{ employeeId: `private-${name}`, password: "never-publish-me" },
					],
				),
			),
		}),
	);
}

test("single-app mixed plan fixes four distinct users, twenty pairs and bounded annual readers without exposing credentials", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-mixed-plan-"));
	try {
		await seedPlan(directory);
		const result = spawnSync(process.execPath, [cli, "plan", directory], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const plan = JSON.parse(result.stdout);
		assert.equal(plan.version, 2);
		assert.equal(plan.semanticTraceIdentities, 56);
		assert.equal(plan.activeRegistrationLimit, 64);
		assert.equal(plan.retainedIdentityLimit, 10000);
		assert.equal(plan.collectorProtocol, "z8-fixture-otlp-collector-v2");
		assert.equal(plan.traceTransport, "context-loopback-proxy-v1");
		assert.equal(plan.browserPolicy, "isolated-profile-no-prediction-v1");
		assert.equal(plan.clockPairs, 20);
		assert.equal(plan.userConcurrency, 4);
		assert.equal(plan.poolMax, 10);
		assert.equal(plan.analyticsCallers.length, 3);
		assert.equal(plan.analyticsMaxRequestsPerCallerPerCommand, 100);
		assert.equal(result.stdout.includes("never-publish-me"), false);
		assert.equal(result.stdout.includes("private-"), false);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

test("mixed plan refuses a nonlocal origin while retaining all other valid fixture prerequisites", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-mixed-reject-"));
	try {
		await seedPlan(directory, "https://production.example.test");
		const result = spawnSync(process.execPath, [cli, "plan", directory], {
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.includes("never-publish-me"), false);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});
