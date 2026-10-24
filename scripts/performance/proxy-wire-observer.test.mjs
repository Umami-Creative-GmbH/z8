import assert from "node:assert/strict";
import test from "node:test";
import {
	createProxyWireObserver,
	proxyWireByteUnits,
	proxyWireProtocol,
} from "./proxy-wire-observer.mjs";

const measured = "a".repeat(32),
	prerequisite = "b".repeat(32);
test("all finite MIME groups count body bytes while explicit prefetch and streams remain separate", () => {
	const wire = createProxyWireObserver();
	wire.begin(0);
	for (const [mime, bytes] of [
		["application/javascript", 43],
		["text/html", 13],
		["text/x-component", 7],
		["application/octet-stream", 5],
	]) {
		const id = wire.request(
			{ traceId: measured, headers: { cookie: "PRIVATE_HEADER_CANARY" } },
			1,
		);
		wire.response(id, { mimeType: mime, status: 200 }, 2);
		wire.bytes(id, bytes, 3);
		wire.end(id, {}, 4);
	}
	const prefetch = wire.request(
		{ traceId: prerequisite, headers: { purpose: "prefetch" } },
		5,
	);
	wire.bytes(prefetch, 100, 6);
	const stream = wire.request({ traceId: prerequisite, headers: {} }, 7);
	wire.response(stream, { mimeType: "text/event-stream", status: 200 }, 8);
	wire.bytes(stream, 1000, 9);
	wire.ready(10);
	const state = wire.state(1010);
	assert.equal(state.complete, true);
	assert.equal(state.protocol, proxyWireProtocol);
	assert.equal(state.byteUnits, proxyWireByteUnits);
	assert.deepEqual(state.bytes, {
		javascript: 43,
		document: 13,
		rsc: 7,
		otherFinite: 5,
	});
	assert.equal(state.groups.prefetch.pending, 1);
	assert.equal(state.groups.longLived.pending, 1);
	assert.equal(state.byTrace.length, 2);
	assert.doesNotMatch(JSON.stringify(state), /PRIVATE_|cookie|"url"|"headers"/);
});
test("inherited finite work drains without being charged and capped windows cannot recover as success", () => {
	const wire = createProxyWireObserver();
	const inherited = wire.request({ traceId: prerequisite, headers: {} }, 0);
	const discarded = wire.request({ traceId: prerequisite, headers: {} }, 1);
	wire.bytes(discarded, 99, 2);
	wire.end(discarded, {}, 3);
	wire.begin(100);
	const fresh = wire.request({ traceId: measured, headers: {} }, 120);
	wire.response(
		fresh,
		{ mimeType: "application/javascript", status: 200 },
		130,
	);
	wire.bytes(fresh, 13, 140);
	wire.end(fresh, {}, 200);
	wire.ready(250);
	wire.response(
		inherited,
		{ mimeType: "application/javascript", status: 200 },
		300,
	);
	wire.bytes(inherited, 41, 350);
	wire.end(inherited, {}, 400);
	assert.equal(wire.state(1300).complete, false);
	const settled = wire.state(1400);
	assert.equal(settled.complete, true);
	assert.equal(settled.bytes.javascript, 13);
	assert.equal(settled.groups.javascript.inheritedCompletedBytes, 41);
	assert.equal(settled.groups.javascript.requests, 2);
	const late = createProxyWireObserver();
	late.begin(0);
	late.ready(10);
	const request = late.request({ traceId: measured, headers: {} }, 9500);
	late.end(request, {}, 9600);
	assert.equal(late.state(11000).complete, false);
	assert.equal(late.state(11000).capped, true);
});
test("unknown finite traffic, ambiguous inherited redirects, errors and observation overflow stay censored", () => {
	const wire = createProxyWireObserver();
	wire.begin(0);
	wire.request({ traceId: measured, headers: {} }, 1);
	wire.ready(2);
	assert.equal(wire.state(11000).capped, true);
	assert.equal(wire.state(11000).mandatoryPending, 1);
	const redirect = createProxyWireObserver();
	const id = redirect.request({ traceId: prerequisite, headers: {} }, 0);
	redirect.begin(1);
	redirect.response(
		id,
		{ mimeType: "text/html", status: 307, redirect: true },
		2,
	);
	redirect.end(id, {}, 3);
	redirect.ready(4);
	assert.equal(redirect.state(1004).complete, false);
	assert.equal(redirect.state(1004).unknownInheritedRedirects, 1);
	const overflow = createProxyWireObserver();
	overflow.begin(0);
	for (let index = 0; index < 10001; index++)
		overflow.request({ traceId: measured, headers: {} }, index);
	overflow.ready(10002);
	const state = overflow.state(12000);
	assert.equal(state.observationOverflows, 1);
	assert.equal(state.groups.otherFinite.requests, 10000);
	assert.equal(state.complete, false);
});
