/** Fresh association-only diagnostic; does not grant body, cancellation, or Native authority. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setImmediate as tick } from "node:timers/promises";
import test from "node:test";
import { createActionResultObserver } from "./action-result-observer.mjs";
import {
	createBrowserControlCollector,
	createProxyControlCollector,
	controlResponseHeader,
} from "./browser-control-collector.mjs";

const origin = "http://localhost:1234";
const url = `${origin}/en?_rsc=fresh-association-fixture`;
const body = '0:{"ok":true}\n';
const requestHeaders = { RSC: "1", "next-router-prefetch": "1" };
const upstreamHeaders = { "content-type": "text/x-component", "cache-control": "public, max-age=60" };

function freshAssociation() {
	const traceId = randomBytes(16).toString("hex");
	const application = createActionResultObserver();
	const proxy = createProxyControlCollector({ contextId: traceId, origin });
	proxy.installed();
	const calls = [];
	const makeCollector = contextId => createBrowserControlCollector({
		contextId,
		origin,
		proxyObservation: () => proxy.snapshot(),
		temporaryRequestObserved(row, kind) {
			calls.push({ requestId: row.requestId, kind });
			return proxy.observeTeamBrowserRequest(row, kind);
		},
		readBody: async () => ({ body, base64Encoded: false }),
	});
	const collector = makeCollector(traceId);
	collector.installed();
	collector.beginMeasurement();
	let ordinal = 0;
	async function network(requestId, { complete = true } = {}) {
		// Same producer ordering and ID composition as trace-transport's synchronous request callback.
		const applicationId = application.request({ traceId, method: "GET", headers: requestHeaders, applicationOrigin: true, compiledAsset: false });
		assert.ok(Number.isSafeInteger(applicationId) && applicationId > 0);
		const id = `${traceId}.${applicationId}`;
		proxy.request(id, { traceId, url, method: "GET", headers: requestHeaders });
		proxy.response(id, { status: 200, headers: upstreamHeaders });
		application.response(applicationId, { status: 200, mimeType: "text/x-component", encoding: "identity" });
		const forwarded = { ...upstreamHeaders, [controlResponseHeader]: id };
		proxy.bytes(id, Buffer.from(body));
		application.bytes(applicationId, Buffer.from(body));
		if (complete) {
			application.end(applicationId);
			proxy.end(id);
		}
		await browser(requestId, forwarded, { fromDiskCache: false }, { unfinished: !complete });
		await tick();
		return { id, forwarded };
	}
	async function browser(requestId, headers, cache, change = {}) {
		const observer = change.foreignContext ? makeCollector(randomBytes(16).toString("hex")) : collector;
		observer.request({ requestId, loaderId: "fresh-loader", frameId: "fresh-frame", type: "Fetch", timestamp: ++ordinal,
			request: { url: change.url ?? url, method: change.method ?? "GET", headers: requestHeaders } });
		observer.requestExtra({ requestId, headers: requestHeaders });
		observer.response({ requestId, response: { status: 200, headers, mimeType: "text/x-component", charset: "", ...cache } });
		observer.responseExtra({ requestId, statusCode: 200, headers });
		if (change.unfinished) return;
		observer.data({ requestId, dataLength: Buffer.byteLength(body) });
		observer.finished({ requestId, timestamp: ++ordinal });
		await tick();
	}
	return { proxy, collector, network, browser, calls };
}

test("cached response association: fresh network rows keep distinct producer IDs without observer errors", async () => {
	const f = freshAssociation();
	try {
		const first = await f.network("network-first");
		const next = await f.network("network-next");
		assert.notEqual(first.id, next.id);
		assert.equal(f.proxy.snapshot().rows.length, 2);
		assert.equal(f.proxy.snapshot().errors, 0);
		assert.equal(f.collector.snapshot().allPhase.coverage.errors, 0);
	} finally { f.proxy.closeTeamValues(); }
});

test("cached response association: known disk cache reuse keeps the original packet without observer errors", async () => {
	const f = freshAssociation();
	try {
		const original = await f.network("network-original");
		const before = structuredClone(f.proxy.snapshot().rows);
		await f.browser("disk-cache-reuse", original.forwarded, { fromDiskCache: true });
		assert.ok(f.calls.some(row => row.requestId === "disk-cache-reuse" && row.kind === "body-settled"), "actual readback finally must exercise the cached body-settled callback");
		assert.deepEqual(f.proxy.snapshot().rows, before, "cache reuse creates no new upstream packet and cannot change its original evidence");
		assert.equal(f.proxy.snapshot().errors, 0, "a known cached response is a new browser receipt of the original packet, not a duplicate live network row");
		assert.equal(f.collector.snapshot().allPhase.coverage.errors, 0);
	} finally { f.proxy.closeTeamValues(); }
});

for (const [name, cache, change] of [
	["uncached reuse", { fromDiskCache: false }, {}],
	["absent cache provenance", {}, {}],
	["unsupported cache flag", { fromDiskCache: "true" }, {}],
	["memory-only flag not recorded by this collector", { fromMemoryCache: true }, {}],
	["service-worker alone without positive cache evidence", { fromServiceWorker: true }, {}],
	["different method", { fromDiskCache: true }, { method: "POST" }],
	["different URL", { fromDiskCache: true }, { url: `${origin}/en/other` }],
	["foreign context", { fromDiskCache: true }, { foreignContext: true }],
]) test(`cached response association: ${name} stays fail-closed`, async () => {
	const f = freshAssociation();
	try {
		const original = await f.network("network-original");
		await f.browser("unqualified-reuse", original.forwarded, cache, change);
		assert.ok(f.proxy.snapshot().errors > 0);
		assert.ok(f.collector.snapshot().allPhase.coverage.errors > 0);
		assert.equal(f.proxy.snapshot().rows.length, 1);
	} finally { f.proxy.closeTeamValues(); }
});

test("cached response association: incomplete original EOF stays fail-closed", async () => {
	const f = freshAssociation();
	try {
		const original = await f.network("network-still-pending", { complete: false });
		assert.equal(f.proxy.snapshot().rows[0].complete, false);
		await f.browser("unproven-cache-ancestry", original.forwarded, { fromDiskCache: true });
		assert.ok(f.proxy.snapshot().errors > 0);
		assert.equal(f.proxy.snapshot().rows[0].complete, false, "the cache receipt cannot finish the original upstream");
	} finally { f.proxy.closeTeamValues(); }
});
