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

test("open header prefixes retain actual no-forward states and cannot satisfy the final census schema", async () => {
 const api = await import("./proxy-header-census.mjs");
 const life = api.createProxyHeaderLifecycle({proxyInstanceId:"c".repeat(32),originSha256:"d".repeat(64),allowedOriginSha256:["d".repeat(64)]});
 const census = createProxyHeaderCensus({contextId});
 for (const number of [1,2,3]) { life.accepted(id(number),"d".repeat(64)); census.accepted(id(number)); life.upstreamCreated(id(number)); }
 life.headersReceived(id(1)); census.headers(id(1),{}); life.headersForwarded(id(1));
 life.upstreamClosed(id(1)); life.upstreamClosed(id(3)); census.terminalBeforeHeaders(id(3),{upstreamClosed:true,headersReceived:false});
 const prefix=api.proxyHeaderPrefix(census.snapshot(),life.snapshot());
 assert.equal(api.validateProxyHeaderPrefix(prefix,{contextId}),true);
 assert.equal(prefix.census.closed,false);
 assert.equal(prefix.lifecycle.pendingUpstreams,1);
 assert.equal(prefix.lifecycle.requests[1].headersForwardedOrdinal,null);
 assert.equal(validateProxyHeaderCensus(prefix,{contextId}),false);
 for(const edit of [p=>p.lifecycle.requests[1].headersForwardedOrdinal=1,p=>p.lifecycle.closedUpstreams++,p=>p.lifecycle.requests.pop(),p=>p.census.closed=true,p=>p.lifecycle.proxyInstanceId="x",p=>p.lifecycle.requests[0].originSha256="e".repeat(64)]) {
  const p=structuredClone(prefix);edit(p);
  assert.equal(api.validateProxyHeaderPrefix(p,{contextId}),false);
 }
 // A later header, including Set-Cookie, creates a new immutable cut and cannot repair/rewrite an older cut.
 life.headersReceived(id(2)); census.headers(id(2),{"set-cookie":"synthetic=value"}); life.headersForwarded(id(2));
 assert.equal(prefix.census.counts.setCookieLines,0);
 const later=api.proxyHeaderPrefix(census.snapshot(),life.snapshot());
 assert.equal(api.validateProxyHeaderPrefix(later,{contextId}),true);
 assert.equal(later.census.counts.setCookieLines,1);
});

test("open header lifecycle is sticky on duplicate/missing/order/overflow/late loss",async()=>{
 const api=await import("./proxy-header-census.mjs");
 const make=()=>api.createProxyHeaderLifecycle({proxyInstanceId:"c".repeat(32),originSha256:"d".repeat(64),allowedOriginSha256:["d".repeat(64)]});
 for(const bad of [life=>life.headersReceived(id(1)),life=>{life.accepted(id(1),"d".repeat(64));life.headersForwarded(id(1));},life=>{life.accepted(id(1),"d".repeat(64));life.accepted(id(1),"d".repeat(64));},life=>{life.accepted(id(1),"e".repeat(64));},life=>{life.close();life.accepted(id(1),"d".repeat(64));}]) {
  const life=make();bad(life);assert.ok(life.snapshot().errors>0);
 }
 const life=make();for(let n=1;n<=proxyHeaderCensusLimit+1;n++)life.accepted(id(n),"d".repeat(64));
 assert.equal(life.snapshot().requests.length,proxyHeaderCensusLimit);assert.equal(life.snapshot().overflow,1);
});
