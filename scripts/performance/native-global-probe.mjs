#!/usr/bin/env node
/** Numerical global wire/SDK/export reconciliation around a finite real production-browser diagnostic. */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { collectorProtocol } from "./collector-client.mjs";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
async function main() {
	if (!args.includes("--run")) {
		console.log(
			"Finite native global proof: --run --plan public-plan.json --auth private-auth.json --collector private-control.json --chrome path --out NEW-directory --condition public-label --route public-route.",
		);
		return;
	}
	for (const name of [
		"--plan",
		"--auth",
		"--collector",
		"--chrome",
		"--out",
		"--condition",
		"--route",
	])
		if (!args.includes(name))
			throw new Error("Finite native proof is missing a required input.");
	const collector = JSON.parse(await readFile(option("--collector"), "utf8"));
	if (collector.kind !== collectorProtocol)
		throw new Error(
			"Finite native proof requires the registered v2 collector.",
		);
	const native = JSON.parse(await readFile(collector.observerControl, "utf8"));
	for (const endpoint of [collector.endpoint, native.endpoint])
		if (
			new URL(endpoint).protocol !== "http:" ||
			new URL(endpoint).hostname !== "127.0.0.1"
		)
			throw new Error("Finite proof requires loopback observers.");
	const counters = async () => {
		const response = await fetch(new URL("/counters", native.endpoint), {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok)
			throw new Error("Native numerical counters are unavailable.");
		return response.json();
	};
	let before = await counters();
	for (let index = 0; index < 20; index++) {
		await pause(250);
		const next = await counters();
		if (
			next.driverQueries === before.driverQueries &&
			next.started.queries === next.ended.queries &&
			next.activeTraces === 0
		) {
			before = next;
			break;
		}
		before = next;
		if (index === 19)
			throw new Error(
				"Native counters did not settle before the finite diagnostic.",
			);
	}
	if (before.driverCounter !== true)
		throw new Error("Independent native wire counter is unavailable.");
	const runnerArgs = [
		fileURLToPath(new URL("./run-baseline.mjs", import.meta.url)),
		"--verify-journeys",
		...[
			"--plan",
			"--auth",
			"--collector",
			"--chrome",
			"--out",
			"--condition",
			"--route",
		].flatMap((name) => [name, option(name)]),
	];
	const code = await new Promise((done, reject) => {
		const child = spawn(process.execPath, runnerArgs, {
			stdio: "inherit",
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("exit", done);
	});
	const after = await counters();
	const artifact = JSON.parse(
		await readFile(join(option("--out"), "baseline.json"), "utf8"),
	);
	const response = await fetch(new URL("/metrics", collector.endpoint), {
		signal: AbortSignal.timeout(10000),
	});
	const metrics = await response.json();
	const ids = new Set(
		artifact.samples.flatMap((sample) => [
			sample.traceId,
			sample.prerequisiteTraceId,
			sample.backgroundTraceId,
		]),
	);
	const evidence = metrics.filter((entry) => ids.has(entry.traceId));
	const wireCalls = after.driverQueries - before.driverQueries;
	const sdkQueries = after.ended.queries - before.ended.queries;
	const exportedQueries = evidence.reduce(
		(sum, entry) => sum + entry.observedQueryCount,
		0,
	);
	const proof = {
		kind: "finite-native-global-proof-v2",
		condition: option("--condition"),
		route: option("--route"),
		samples: artifact.samples.length,
		browserFailures: artifact.samples.filter((sample) => sample.failed).length,
		wireCalls,
		sdkQueries,
		exportedQueries,
		pendingNativeQueries: after.started.queries - after.ended.queries,
		activeTraces: after.activeTraces,
		incoming: Object.fromEntries(
			Object.entries(after.incoming).map(([key, value]) => [
				key,
				value - before.incoming[key],
			]),
		),
		allReceivedTracesReconciled: evidence.every(
			(entry) =>
				entry.coverage.nativeProof === true &&
				entry.coverage.incomplete === false &&
				entry.coverage.closed === true &&
				entry.coverage.unattributedNativeSpans === 0 &&
				entry.coverage.lateSpans === 0,
		),
		complete: false,
	};
	proof.runnerCollectionExitCode = code;
	proof.complete =
		code === 1 &&
		artifact.kind === "journey-verification" &&
		artifact.runtime.buildVerified === true &&
		artifact.samples.length > 0 &&
		proof.browserFailures === 0 &&
		wireCalls === sdkQueries &&
		sdkQueries === exportedQueries &&
		proof.pendingNativeQueries === 0 &&
		proof.activeTraces === 0 &&
		proof.allReceivedTracesReconciled;
	await writeFile(
		join(option("--out"), "native-global-proof.json"),
		JSON.stringify(proof, null, 2),
	);
	await writeFile(
		join(option("--out"), "backend-metrics.json"),
		JSON.stringify(evidence, null, 2),
	);
	console.log(JSON.stringify(proof));
	if (!proof.complete) process.exitCode = 1;
}
main().catch(() => {
	console.error(
		"Finite native proof could not complete; inspect numerical artifacts. No credentials or SQL were emitted.",
	);
	process.exitCode = 1;
});
