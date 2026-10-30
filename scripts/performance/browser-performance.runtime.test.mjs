import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("primary CLI retains actual native LCP when a painted document fails functional readiness", {
	timeout: 20000,
}, async () => {
	assert.ok(
		process.env.Z8_TEST_CHROME_PATH,
		"Explicit installed Chrome path required.",
	);
	const directory = await mkdtemp(join(tmpdir(), "z8-failed-ui-paint-"));
	const server = createServer((request, response) => {
		if (request.url === "/api/app-version") {
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ buildHash: "39a08d0bb" }));
			return;
		}
		response.setHeader("Content-Type", "text/html");
		response.end(
			'<!doctype html><link rel="icon" href="data:,"><h1 style="font-size:60px">Observed native document paint</h1><button id="clock">Clock In</button>',
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const origin = `http://127.0.0.1:${server.address().port}`;
		const plan = {
			phase: "baseline",
			samples: 20,
			concurrency: 1,
			timeoutMs: 1000,
			origin,
			fixture: { kind: "disposable", journeysVerified: true },
			runtime: { mode: "production", build: "39a08d0bb" },
			ranges: ["month", "quarter", "year"].map((name) => ({ name })),
			conditions: ["employee", "manager", "admin", "restricted"].map(
				(role, index) => ({
					name: role,
					role,
					organization: index % 2 ? "large" : "small",
					size: index % 2 ? "large" : "small",
					timezone: "Europe/Berlin",
					locale: "en",
					viewport: { width: 1280, height: 900 },
				}),
			),
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
				ranges: ["year"],
				ready: "#missing-functional-content",
				clockReady: "#clock",
				link: "a",
				refresh: "#clock",
				mutation: {
					steps: [{ click: "#clock" }],
					ready: "#clock",
					reset: [{ click: "#clock" }],
				},
			})),
		};
		const planPath = join(directory, "plan.json"),
			auth = join(directory, "auth.json"),
			out = join(directory, "out");
		await writeFile(planPath, JSON.stringify(plan));
		await writeFile(auth, JSON.stringify({ admin: { cookies: [] } }));
		let stderr = "";
		const code = await new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"scripts/performance/run-baseline.mjs",
					"--verify-journeys",
					"--plan",
					planPath,
					"--auth",
					auth,
					"--chrome",
					process.env.Z8_TEST_CHROME_PATH,
					"--out",
					out,
					"--condition",
					"admin",
					"--route",
					"dashboard",
					"--mode",
					"first-document",
				],
				{ stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
			);
			child.stderr.on("data", (chunk) => (stderr += chunk));
			child.once("error", reject);
			child.once("exit", resolve);
		});
		assert.equal(code, 1, stderr);
		const artifact = JSON.parse(await readFile(join(out, "baseline.json")));
		const [sample] = artifact.samples;
		assert.equal(artifact.samples.length, 1);
		assert.equal(sample.failed, true);
		assert.equal(sample.failureKind, "timeout");
		assert.equal(sample.usableContentMs, null);
		assert.ok(
			sample.lcpMs > 0,
			"A failed functional check must retain its already observed native paint",
		);
		assert.ok(sample.nativePerformanceObservation.lcpEntries > 0);
		assert.equal(artifact.summaries[0].usableContentMs, null);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});
