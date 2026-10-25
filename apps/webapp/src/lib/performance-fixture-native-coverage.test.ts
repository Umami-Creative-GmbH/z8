// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { SpanKind } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import {
	FixtureNativeCoverage,
	startFixtureNativeControl,
} from "./performance-fixture-native-coverage";

const traceId = "a".repeat(32);
const span = (name: string, kind: SpanKind, scope?: string) => ({
	name,
	kind,
	instrumentationScope: {
		name: scope ?? "@opentelemetry/instrumentation-http",
	},
	spanContext: () => ({ traceId }),
});

describe("native SDK-enum request lifecycle", () => {
	it("keeps a SERVER span fixture open beyond the quiet interval and includes its later child query", async () => {
		const coverage = new FixtureNativeCoverage();
		coverage.enableDriverCounter();
		coverage.register([traceId]);
		const server = span("GET /fixture", SpanKind.SERVER);
		coverage.onStart(server);
		let closedBeforeServerEnd = false;
		let serverEnded = false;
		const closing = coverage.drain([traceId]).then((drained) => {
			closedBeforeServerEnd = !serverEnded;
			expect(drained).toBe(true);
			return coverage.close([traceId])[0];
		});
		await pause(650);
		const child = span(
			"pg.query",
			SpanKind.CLIENT,
			"@opentelemetry/instrumentation-pg",
		);
		coverage.driverQuery(traceId);
		coverage.onStart(child);
		await pause(25);
		coverage.onEnd(child);
		serverEnded = true;
		coverage.onEnd(server);
		const proof = await closing;
		expect(closedBeforeServerEnd).toBe(false);
		expect(proof).toMatchObject({
			queries: 1,
			driverQueries: 1,
			complete: true,
			driverComplete: true,
			serverBalance: 0,
			serverStarted: 1,
			serverEnded: 1,
			serverScopes: {
				http: { started: 1, ended: 1 },
				next: { started: 0, ended: 0 },
				other: { started: 0, ended: 0 },
			},
		});
		expect(proof.lastActivityAgeMs).toBeGreaterThanOrEqual(500);
		expect(coverage.snapshot().unknown).toBe(0);
	});

	it("does not mistake a CLIENT span fixture for an active server request", async () => {
		const coverage = new FixtureNativeCoverage();
		coverage.register([traceId]);
		const client = span("outgoing HTTP", SpanKind.CLIENT);
		coverage.onStart(client);
		const draining = coverage.drain([traceId]);
		const beforeClientEnd = await Promise.race([
			draining.then(() => true),
			pause(750).then(() => false),
		]);
		coverage.onEnd(client);
		await draining;
		expect(beforeClientEnd).toBe(true);
	});

	it("reports an open Next server after the unchanged drain cap without accepting balanced queries", async () => {
		const folder = await mkdtemp(join(tmpdir(), "z8-native-close-diagnostic-"));
		const coverage = new FixtureNativeCoverage();
		coverage.enableDriverCounter();
		coverage.register([traceId]);
		const http = span("fixed-http-fixture", SpanKind.SERVER);
		const next = span("fixed-next-fixture", SpanKind.SERVER, "next.js");
		const other = span(
			"fixed-other-fixture",
			SpanKind.SERVER,
			"technical-fixture",
		);
		coverage.onStart(http);
		coverage.onEnd(http);
		coverage.onStart(next);
		coverage.onStart(other);
		coverage.onEnd(other);
		const controlPath = join(folder, "control.json");
		const control = await startFixtureNativeControl(
			coverage,
			async () => {},
			controlPath,
		);
		try {
			const { endpoint } = JSON.parse(await readFile(controlPath, "utf8"));
			const response = await fetch(new URL("/visits/close", endpoint), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ traceIds: [traceId] }),
			});
			expect(response.status).toBe(200);
			const { proof } = await response.json();
			expect(proof[0]).toMatchObject({
				queries: 0,
				acquisitions: 0,
				cache: 0,
				started: { queries: 0, acquisitions: 0, cache: 0 },
				ended: { queries: 0, acquisitions: 0, cache: 0 },
				driverQueries: 0,
				driverComplete: true,
				complete: false,
				drained: false,
				serverBalance: 1,
				serverStarted: 3,
				serverEnded: 2,
				serverScopes: {
					http: { started: 1, ended: 1 },
					next: { started: 1, ended: 0 },
					other: { started: 1, ended: 1 },
				},
			});
			expect(proof[0].drainElapsedMs).toBeGreaterThanOrEqual(10000);
			expect(proof[0].lastActivityAgeMs).toBeGreaterThanOrEqual(10000);
		} finally {
			control.closeAllConnections();
			await new Promise<void>((resolve) => control.close(() => resolve()));
			await rm(folder, { recursive: true, force: true });
		}
	}, 15000);
});
