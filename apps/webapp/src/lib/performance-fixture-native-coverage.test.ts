// @vitest-environment node
import { setTimeout as pause } from "node:timers/promises";
import { SpanKind } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { FixtureNativeCoverage } from "./performance-fixture-native-coverage";

const traceId = "a".repeat(32);
const span = (name: string, kind: SpanKind, scope?: string) => ({
	name,
	kind,
	instrumentationScope: {
		name: scope ?? "@opentelemetry/instrumentation-http",
	},
	spanContext: () => ({ traceId }),
});

describe("native SDK request lifecycle", () => {
	it("keeps an actual SDK server open beyond the quiet interval and includes its later child query", async () => {
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
		});
		expect(coverage.snapshot().unknown).toBe(0);
	});

	it("does not mistake an actual SDK client span for an active server request", async () => {
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
});
