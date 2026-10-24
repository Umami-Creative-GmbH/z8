import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
		mutation: {
			steps: [{ click: "button" }],
			ready: "main",
			reset: [{ click: "button" }],
		},
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

test("unknown per-route ranges cannot silently remove required cohorts", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-range-"));
	try {
		const planPath = join(folder, "plan.json");
		const plan = fixturePlan();
		plan.routes[0].ranges = ["unknown-range"];
		writeFileSync(planPath, JSON.stringify(plan));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", planPath, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /known range/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("per-mode counts cannot reduce mandatory warm samples below twenty", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-count-"));
	try {
		const path = join(folder, "plan.json");
		writeFileSync(
			path,
			JSON.stringify({ ...fixturePlan(), samplesByMode: { "repeat-link": 5 } }),
		);
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /twenty/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("mutation measurement requires an explicit restoration recipe", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-reset-"));
	try {
		const path = join(folder, "plan.json");
		const plan = fixturePlan();
		delete plan.routes[0].mutation.reset;
		writeFileSync(path, JSON.stringify(plan));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /restoration/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("a fully observed failed predecessor is recorded while the same failure blocks release", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-predecessor-"));
	try {
		const plan = {
			...fixturePlan(),
			phase: "baseline",
			samplesByMode: {
				"return-visit": 1,
				"manual-refresh": 1,
				"mutation-refresh": 1,
			},
		};
		const samples = [];
		const summaries = [];
		for (const condition of plan.conditions)
			for (const range of plan.ranges)
				for (const route of plan.routes)
					for (const mode of [
						"first-document",
						"repeat-link",
						"return-visit",
						"manual-refresh",
						"mutation-refresh",
					]) {
						const failed =
							condition.name === "admin" &&
							route.name === "analytics" &&
							range.name === "year";
						const count = ["first-document", "repeat-link"].includes(mode)
							? 20
							: 1;
						for (let iteration = 0; iteration < count; iteration++)
							samples.push({
								condition: condition.name,
								range: range.name,
								route: route.name,
								mode,
								iteration,
								traceId: samples.length.toString(16).padStart(32, "0"),
								failed,
								usableContentMs: failed ? null : 10,
								failureStage: failed ? "verify-results" : null,
								elapsedUntilFailureMs: failed ? 30000 : null,
								restored: true,
								resourceWindowComplete: true,
							});
						summaries.push({
							condition: condition.name,
							range: range.name,
							route: route.name,
							mode,
							samples: count,
							failed: failed ? count : 0,
							usableContentMs: failed ? null : { p95: 10 },
						});
					}
		const planPath = join(folder, "plan.json");
		const artifactPath = join(folder, "baseline.json");
		const backendPath = join(folder, "backend.json");
		writeFileSync(
			backendPath,
			JSON.stringify(
				samples.map((sample) => ({
					traceId: sample.traceId,
					queryCount: 1,
					queryDurationMs: 2,
					rowsRetrieved: 3,
					poolWaitMs: 4,
					cacheHits: 1,
					cacheMisses: 1,
					eventLoopDelayMs: 2,
				})),
			),
		);
		const finalize = (phase) => {
			plan.phase = phase;
			const bytes = JSON.stringify(plan);
			writeFileSync(planPath, bytes);
			writeFileSync(
				artifactPath,
				JSON.stringify({
					kind: "benchmark",
					runtime: { buildVerified: true },
					planSha256: createHash("sha256").update(bytes).digest("hex"),
					samples,
					summaries,
				}),
			);
			const command = spawnSync(
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
			return {
				command,
				artifact: JSON.parse(readFileSync(artifactPath, "utf8")),
			};
		};
		const predecessor = finalize("baseline");
		assert.equal(predecessor.command.status, 0);
		assert.equal(predecessor.artifact.acceptance, "baseline-recorded");
		assert.equal(predecessor.artifact.releaseAcceptance, "failed");
		assert.equal(
			predecessor.artifact.summaries.find((summary) => summary.failed > 0)
				.usableContentMs,
			null,
		);
		const release = finalize("release");
		assert.equal(release.command.status, 1);
		assert.equal(release.artifact.acceptance, "unfulfilled");
		assert.match(release.artifact.releaseGates.join(" "), /failed browser/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
