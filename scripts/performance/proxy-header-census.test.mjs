import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
	createProxyHeaderCensus,
	proxyHeaderCensusLimit,
	validateProxyHeaderCensus,
} from "./proxy-header-census.mjs";

const contextId = "a".repeat(32);
const id = (number) => `${"b".repeat(32)}.${number}`;

test("known upstream headers close as explicit per-request facts", () => {
	const census = createProxyHeaderCensus({ contextId });
	census.accepted(id(1));
	census.headers(id(1), { "content-type": "text/plain" });
	census.close();
	const proof = census.snapshot();
	assert.equal(proof.closed, true);
	assert.deepEqual(proof.requests, [
		{
			requestId: id(1),
			observation: "headers",
			setCookieLines: 0,
			setCookieSha256: null,
		},
	]);
	assert.equal(proof.counts.accepted, 1);
	assert.equal(proof.counts.knownHeaders, 1);
	assert.equal(proof.counts.pending, 0);
	assert.equal(validateProxyHeaderCensus(proof, { contextId }), true);
	assert.equal(Object.hasOwn(proof, "eligible"), false);
});

test("serialized validation rejects forged schema even with an updated facts digest", () => {
	const census = createProxyHeaderCensus({ contextId });
	census.accepted(id(1));
	census.headers(id(1), {});
	census.close();
	const good = census.snapshot();
	const rehash = (proof) => {
		const { counts, censusSha256, ...facts } = proof;
		proof.censusSha256 = createHash("sha256")
			.update(JSON.stringify(facts))
			.digest("hex");
		return proof;
	};
	for (const corrupt of [
		(proof) => {
			proof.closed = "true";
		},
		(proof) => {
			proof.requests[0].rawCookie = "PRIVATE";
		},
		(proof) => {
			proof.requests[0].requestId = "PRIVATE";
		},
		(proof) => {
			proof.unretainedFaults.error = NaN;
			proof.counts.errors = NaN;
			proof.counts.overflow = NaN;
		},
		(proof) => {
			proof.requests[0].setCookieLines = -1;
			proof.counts.setCookieLines = -1;
		},
	]) {
		const forged = structuredClone(good);
		corrupt(forged);
		rehash(forged);
		assert.equal(validateProxyHeaderCensus(forged, { contextId }), false);
	}
	const wrongCounts = structuredClone(good);
	wrongCounts.counts.accepted = 0;
	assert.equal(validateProxyHeaderCensus(wrongCounts, { contextId }), false);
	assert.equal(
		validateProxyHeaderCensus(good, { contextId: "c".repeat(32) }),
		false,
	);
	assert.equal(validateProxyHeaderCensus(good), false);
});

test("request and fault storage is bounded without manufacturing a closed zero-pending census", () => {
	const census = createProxyHeaderCensus({ contextId });
	for (let number = 1; number <= proxyHeaderCensusLimit + 1; number++)
		census.accepted(id(number));
	for (let number = 0; number <= proxyHeaderCensusLimit; number++)
		census.observerError();
	census.close();
	census.headers(id(1), {});
	const proof = census.snapshot();
	assert.equal(proof.requests.length, 10000);
	assert.equal(proof.counts.accepted, 10000);
	assert.equal(proof.counts.pending, 10000);
	assert.equal(proof.faults.length, 10000);
	assert.equal(proof.counts.errors, 10001);
	assert.equal(proof.counts.late, 1);
	assert.ok(proof.counts.overflow > 0);
	assert.equal(validateProxyHeaderCensus(proof, { contextId }), true);
});

test("duplicates, missing identities and late events stay sticky and cannot repair unknown headers", () => {
	const census = createProxyHeaderCensus({ contextId });
	census.headers(id(9), {});
	census.accepted("https://PRIVATE.invalid/");
	census.accepted(id(1));
	census.accepted(id(1));
	census.headers(id(1), undefined);
	census.headers(id(1), {});
	census.terminalBeforeHeaders(id(1), {
		upstreamClosed: true,
		headersReceived: false,
	});
	census.observerError();
	census.close();
	census.headers(id(1), {});
	census.accepted(id(2));
	census.close();
	const proof = census.snapshot();
	assert.equal(proof.counts.accepted, 1);
	assert.equal(proof.counts.unknownHeaders, 1);
	assert.equal(proof.counts.missing, 1);
	assert.equal(proof.counts.duplicates, 4);
	assert.equal(proof.counts.late, 2);
	assert.equal(proof.counts.errors, 2);
	assert.doesNotMatch(JSON.stringify(proof), /PRIVATE|invalid|https/);
	assert.equal(validateProxyHeaderCensus(proof, { contextId }), true);
});

test("only an explicit upstream-closed-before-headers fact discharges pending headers", () => {
	const census = createProxyHeaderCensus({ contextId });
	census.accepted(id(1));
	census.accepted(id(2));
	census.terminalBeforeHeaders(id(1), {
		upstreamClosed: true,
		headersReceived: false,
	});
	census.terminalBeforeHeaders(id(2), {
		upstreamClosed: false,
		headersReceived: false,
	});
	census.close();
	const proof = census.snapshot();
	assert.equal(proof.counts.terminalBeforeHeaders, 1);
	assert.equal(proof.counts.pending, 1);
	assert.equal(proof.counts.errors, 1);
	assert.equal(proof.requests[1].setCookieLines, null);
	assert.equal(validateProxyHeaderCensus(proof, { contextId }), true);
});

test("unavailable or malformed header snapshots remain unknown without executing getters", () => {
	let getterCalls = 0;
	const accessor = Object.defineProperty({}, "set-cookie", {
		enumerable: true,
		get() {
			getterCalls++;
			return "PRIVATE";
		},
	});
	for (const headers of [
		undefined,
		null,
		[],
		{ "set-cookie": undefined },
		{ "set-cookie": 7 },
		{ "set-cookie": ["ok", null] },
		{ x: "x".repeat(65537) },
		accessor,
	]) {
		const census = createProxyHeaderCensus({ contextId });
		census.accepted(id(1));
		census.headers(id(1), headers);
		census.close();
		const proof = census.snapshot();
		assert.equal(proof.requests[0].observation, "unknown-headers");
		assert.equal(proof.requests[0].setCookieLines, null);
		assert.equal(proof.counts.unknownHeaders, 1);
		assert.equal(validateProxyHeaderCensus(proof, { contextId }), true);
	}
	assert.equal(getterCalls, 0);
});

test("Set-Cookie presence is retained as bounded hashed facts, never raw values", () => {
	const census = createProxyHeaderCensus({ contextId });
	census.accepted(id(1));
	census.headers(id(1), {
		"Set-Cookie": ["PRIVATE_SESSION=first", "PRIVATE_SESSION=second"],
	});
	census.close();
	const proof = census.snapshot();
	assert.equal(proof.counts.setCookieResponses, 1);
	assert.equal(proof.counts.setCookieLines, 2);
	assert.match(proof.requests[0].setCookieSha256, /^[a-f0-9]{64}$/);
	assert.doesNotMatch(
		JSON.stringify(proof),
		/PRIVATE_SESSION|first|second|Set-Cookie/,
	);
	assert.equal(validateProxyHeaderCensus(proof, { contextId }), true);
});
