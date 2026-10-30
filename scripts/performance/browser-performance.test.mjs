import assert from "node:assert/strict";
import test from "node:test";
import { captureObservedBrowserMetrics } from "./browser-performance.mjs";

test("failed measured UI retains actual native paint without replacing failed usable-content timing", async () => {
	const sample = {
		failed: true,
		usableContentMs: null,
		lcpMs: null,
		interactionMaxMs: null,
		failureStage: "verify-expected-content",
	};
	await captureObservedBrowserMetrics({
		sample,
		page: {
			isClosed: () => false,
			evaluate: async () => ({
				lcp: 834,
				inp: 32,
				lcpEntries: 2,
				eventEntries: 1,
			}),
		},
		measurementStarted: true,
		mode: "first-document",
	});
	assert.equal(sample.lcpMs, 834);
	assert.equal(sample.interactionMaxMs, 32);
	assert.equal(sample.failed, true);
	assert.equal(sample.usableContentMs, null);
	assert.equal(sample.failureStage, "verify-expected-content");
	assert.equal(sample.nativePerformanceObservation.lcpEntries, 2);
});

test("missing paint stays null and an unattempted prerequisite never reads its document paint", async () => {
	const sample = {
		failed: true,
		usableContentMs: null,
		lcpMs: null,
		interactionMaxMs: null,
	};
	let reads = 0;
	const page = {
		isClosed: () => false,
		evaluate: async () => {
			reads++;
			return { lcp: null, inp: null, lcpEntries: 0, eventEntries: 0 };
		},
	};
	await captureObservedBrowserMetrics({
		sample,
		page,
		measurementStarted: false,
		mode: "first-document",
	});
	assert.equal(reads, 0);
	assert.equal(sample.lcpMs, null);
	await captureObservedBrowserMetrics({
		sample,
		page,
		measurementStarted: true,
		mode: "first-document",
	});
	assert.equal(reads, 1);
	assert.equal(sample.lcpMs, null);
	assert.equal(sample.nativePerformanceObservation.lcpEntries, 0);
});
