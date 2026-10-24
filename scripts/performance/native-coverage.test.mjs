import assert from "node:assert/strict";
import test from "node:test";
import { FixtureNativeCoverage } from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";

const span = (
	traceId,
	name = "pg.query",
	scope = "@opentelemetry/instrumentation-pg",
) => ({
	name,
	instrumentationScope: { name: scope },
	spanContext: () => ({ traceId }),
});
test("native lifecycle detects pending, dropped, and unowned work without storing SQL", () => {
	const coverage = new FixtureNativeCoverage();
	const first = "a".repeat(32),
		second = "b".repeat(32);
	coverage.register([first, second]);
	coverage.onStart(span(first));
	coverage.onEnd(span(first));
	coverage.onStart(span(second));
	const proof = coverage.close([first, second]);
	assert.equal(proof[0].complete, true);
	assert.equal(proof[0].queries, 1);
	assert.equal(proof[1].complete, false);
	assert.equal(proof[1].started.queries, 1);
	assert.equal(proof[1].ended.queries, 0);
	coverage.register([first]);
	coverage.onStart(span("c".repeat(32)));
	coverage.onEnd(span("c".repeat(32)));
	assert.equal(coverage.close([first])[0].complete, false);
	assert.equal(coverage.snapshot().activeTraces, 0);
});
test("concurrent native identities stay distinct and a million irrelevant spans consume no retained state", () => {
	const coverage = new FixtureNativeCoverage();
	const first = "a".repeat(32),
		second = "b".repeat(32);
	coverage.register([first, second]);
	for (let index = 0; index < 1000001; index++)
		coverage.onStart(span(first, "manual", "effect"));
	for (let index = 0; index < 3; index++) {
		coverage.onStart(span(first));
		coverage.onEnd(span(first));
	}
	for (let index = 0; index < 5; index++) {
		coverage.onStart(span(second));
		coverage.onEnd(span(second));
	}
	const proof = coverage.close([first, second]);
	assert.deepEqual(
		proof.map(({ queries, complete }) => ({ queries, complete })),
		[
			{ queries: 3, complete: true },
			{ queries: 5, complete: true },
		],
	);
	assert.equal(coverage.snapshot().activeTraces, 0);
	assert.equal(coverage.snapshot().ended.queries, 8);
});
