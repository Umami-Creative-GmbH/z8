import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./run-baseline.mjs", import.meta.url));
const fixturePlan = () => ({
	samples: 20,
	concurrency: 1,
	fixture: { kind: "disposable", journeysVerified: true },
	runtime: { mode: "production", build: "39a08d0bb" },
	origin: "http://localhost:34123",
	ranges: ["month", "quarter", "year"].map((name) => ({ name })),
	conditions: ["employee", "manager", "admin", "restricted"].map((role, i) => ({
		name: role,
		role,
		organization: i % 2 ? "large" : "small",
		size: i % 2 ? "large" : "small",
		timezone: "Europe/Berlin",
		locale: "en",
		viewport: { width: 1280, height: 900 },
		budgets: {
			usableContentP95Ms: 5000,
			clockReadyP95Ms: 3000,
			javascriptP95Bytes: 1000000,
			queryCountP95: 100,
		},
	})),
	routes: [
		"dashboard",
		"time-tracking",
		"employee-directory",
		"employee-detail",
		"reports",
		"analytics",
	].map((name) => ({
		name,
		path: "/en",
		ready: "main",
		clockReady: "button:not(:disabled)",
		link: "a",
		refresh: "button",
		mutation: { steps: [{ click: "button" }], ready: "main" },
	})),
});

test("the baseline command refuses an absent fixture plan before opening a browser", () => {
	const result = spawnSync(process.execPath, [runner, "--validate-plan"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 2);
	assert.match(result.stderr, /A fixture plan is required/);
});

test("the baseline command rejects a cohort below twenty without printing private plan values", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-cli-"));
	try {
		const path = join(folder, "plan.json");
		writeFileSync(
			path,
			JSON.stringify({ samples: 3, password: "private-canary-value" }),
		);
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /at least twenty/);
		assert.doesNotMatch(result.stderr + result.stdout, /private-canary-value/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("finalizing browser observations without backend evidence keeps the acceptance gate unfulfilled", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-gate-"));
	try {
		const planPath = join(folder, "plan.json");
		const artifactPath = join(folder, "baseline.json");
		const planBytes = JSON.stringify(fixturePlan());
		writeFileSync(planPath, planBytes);
		writeFileSync(
			artifactPath,
			JSON.stringify({
				planSha256: createHash("sha256").update(planBytes).digest("hex"),
				samples: [{ traceId: "a".repeat(32), failed: false }],
				summaries: [],
			}),
		);
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", planPath, "--finalize", artifactPath],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /Baseline acceptance: unfulfilled/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("one successful sample cannot stand in for all planned first and warm cohorts", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-cohort-"));
	try {
		const planPath = join(folder, "plan.json");
		const artifactPath = join(folder, "baseline.json");
		const backendPath = join(folder, "backend.json");
		const planBytes = JSON.stringify(fixturePlan());
		writeFileSync(planPath, planBytes);
		const traceId = "a".repeat(32);
		writeFileSync(
			artifactPath,
			JSON.stringify({
				planSha256: createHash("sha256").update(planBytes).digest("hex"),
				samples: [{ traceId, failed: false }],
				summaries: [],
			}),
		);
		writeFileSync(
			backendPath,
			JSON.stringify([
				{
					traceId,
					queryCount: 1,
					queryDurationMs: 2,
					rowsRetrieved: 3,
					poolWaitMs: 0,
					cacheHits: 0,
					cacheMisses: 1,
					eventLoopDelayMs: 0,
				},
			]),
		);
		const result = spawnSync(
			process.execPath,
			[
				runner,
				"--plan",
				planPath,
				"--finalize",
				artifactPath,
				"--backend",
				backendPath,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /Baseline acceptance: unfulfilled/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
