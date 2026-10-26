import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { chromiumSWRRevision } from "./control-cancellation-evidence.mjs";
import {
	createBrowserControlCollector,
	createProxyControlCollector,
	installBrowserControlCollector,
	controlDocumentHeader,
	controlResponseHeader,
} from "./browser-control-collector.mjs";

const origin = "http://localhost:1234",
	url = `${origin}/en?_rsc=PRIVATE_QUERY`,
	contextId = "fixture-context";
const headers = {
	RSC: "1",
	"next-router-prefetch": "1",
	"Accept-Language": "en",
	[controlDocumentHeader]: `${contextId}:2`,
};
const responseHeaders = {
	"content-type": "text/x-component",
	"cache-control": "s-maxage=100, stale-while-revalidate=200",
};
const body = '#0:{"b":"PRIVATE_BUILD","t":{"t":{"s":""}}}\n';
const event = (requestId, timestamp, type = "Fetch") => ({
	requestId,
	timestamp,
	loaderId: "current-loader",
	type,
	initiator: { type: type === "Other" ? "other" : "script" },
	request: { url, method: "GET", headers, initialPriority: "VeryLow" },
});

test("actual CDP/body and proxy events produce a control proof without publishing payload or header values", async () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		browserRevision: chromiumSWRRevision,
		proxyObservation: proxy.snapshot,
		readBody: async (id) => {
			if (id !== "cached") throw Error("PRIVATE_CDP_ERROR");
			return { body, base64Encoded: false };
		},
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("cached", 1));
	collector.requestExtra({ requestId: "cached", headers });
	collector.response({
		requestId: "cached",
		response: {
			status: 200,
			headers: responseHeaders,
			fromDiskCache: true,
			fromServiceWorker: false,
		},
	});
	collector.finished({ requestId: "cached", timestamp: 2 });
	const id = `${"a".repeat(32)}.2`;
	proxy.request(id, { url, method: "GET", headers, traceId: "a".repeat(32) });
	proxy.response(id, { status: 200, headers: responseHeaders });
	proxy.bytes(id, Buffer.from("unread"));
	proxy.cancel(id);
	collector.request(event("background", 3, "Other"));
	collector.requestExtra({ requestId: "background", headers });
	collector.responseExtra({
		requestId: "background",
		statusCode: 200,
		headers: { ...responseHeaders, [controlResponseHeader]: id },
	});
	collector.recordMeasuredFailure("background");
	collector.failed({
		requestId: "background",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endMeasurement();
	collector.endScope();
	await tick();
	await tick();
	const proof = collector.snapshot();
	assert.equal(proof.measured.complete, true);
	assert.equal(proof.measured.rawFailedRequests, 1);
	assert.equal(proof.measured.provenControls, 1);
	assert.equal(proof.measured.unknownFailures, 0);
	assert.equal(
		proof.bodyReceipts.find((row) => row.requestId === "background").bodyProof
			.complete,
		false,
	);
	assert.doesNotMatch(
		JSON.stringify([proof, proxy.snapshot()]),
		/PRIVATE_|unread|content-type|Accept-Language/,
	);
});

test("scope end excludes later browser teardown failures from the measured raw window", async () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		proxyObservation: proxy.snapshot,
		readBody() {
			throw Error("unavailable");
		},
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("late", 1));
	collector.requestExtra({ requestId: "late", headers });
	collector.endMeasurement();
	collector.failed({
		requestId: "late",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.endScope();
	await tick();
	assert.equal(collector.snapshot().measured.rawFailedRequests, 0);
	assert.equal(collector.snapshot().allPhase.rawFailedRequests, 1);
	assert.equal(collector.snapshot().allPhase.unknownFailures, 1);
	assert.equal(collector.snapshot().allPhase.coverage.errors, 0);
});

test("proxy EOF does not hold forwarding for decoding and genuine upstream errors cannot become controls", async () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	proxy.request("1", { url, method: "GET", headers, traceId: "a".repeat(32) });
	proxy.response("1", { status: 200, headers: responseHeaders });
	proxy.bytes("1", Buffer.from(body));
	proxy.end("1");
	assert.equal(proxy.snapshot().pendingBodies, 1);
	assert.equal(proxy.snapshot().rows[0].bodyProof, undefined);
	await tick();
	assert.equal(proxy.snapshot().pendingBodies, 0);
	assert.equal(proxy.snapshot().rows[0].bodyProof.complete, true);
	proxy.failure("1");
	assert.equal(proxy.snapshot().rows[0].upstreamError, true);
});

test("installation preserves navigation arguments/results/errors and adds only declared identity metadata", async () => {
	const session = new EventEmitter(),
		calls = [],
		error = Error("original-error");
	session.send = async (method, args) => {
		calls.push([method, args]);
		return {};
	};
	session.detach = async () => calls.push(["detach"]);
	const args = [url, { waitUntil: "domcontentloaded" }];
	const page = { createCDPSession: async () => session };
	const goto = function (...actual) {
		assert.equal(this, page);
		assert.deepEqual(actual, args);
		return Promise.resolve("original-result");
	};
	page.goto = goto;
	page.reload = () => Promise.reject(error);
	page.goBack = async () => null;
	const transport = {
		setControlCancellationObserver(observer) {
			observer.installed();
			return () => 0;
		},
	};
	const observer = await installBrowserControlCollector({
		page,
		transport,
		origin,
		headers: { "Accept-Language": "en" },
		contextId,
		browserRevision: chromiumSWRRevision,
	});
	assert.equal(await page.goto(...args), "original-result");
	await assert.rejects(page.reload(), (value) => value === error);
	assert.equal(
		calls.filter(([method]) => method === "Network.setExtraHTTPHeaders").length,
		2,
	);
	assert.equal(calls[1][1].headers["Accept-Language"], "en");
	await observer.close();
	assert.equal(page.goto, goto);
});

test("the actual compiled unmarked fallback is passed identically to browser and proxy readers", async () => {
	for (const compiledCachedNavigations of [undefined, false]) {
		const proxy = createProxyControlCollector({
			contextId,
			compiledCachedNavigations,
		});
		proxy.installed();
		const unmarked = '0:{"t":{"t":{"s":""}}}\n';
		const collector = createBrowserControlCollector({
			contextId,
			origin,
			compiledCachedNavigations,
			proxyObservation: proxy.snapshot,
			readBody: async () => ({ body: unmarked, base64Encoded: false }),
		});
		collector.installed();
		collector.beginMeasurement();
		proxy.request("1", {
			url,
			method: "GET",
			headers,
			traceId: "a".repeat(32),
		});
		proxy.response("1", { status: 200, headers: responseHeaders });
		proxy.bytes("1", Buffer.from(unmarked));
		proxy.end("1");
		collector.request(event("1", 1));
		collector.requestExtra({ requestId: "1", headers });
		collector.response({
			requestId: "1",
			response: { status: 200, headers: responseHeaders, fromDiskCache: true },
		});
		collector.finished({ requestId: "1", timestamp: 2 });
		collector.endMeasurement();
		collector.endScope();
		await tick();
		await tick();
		const browser = collector.snapshot().bodyReceipts[0].bodyProof;
		const forwarded = proxy.snapshot().rows[0].bodyProof;
		assert.equal(browser.complete, compiledCachedNavigations === false);
		assert.deepEqual(browser, forwarded);
	}
});

test("measured selection uses the actual raw listener ID list rather than all-phase callback timing", () => {
	const proxy = createProxyControlCollector({ contextId });
	proxy.installed();
	const collector = createBrowserControlCollector({
		contextId,
		origin,
		proxyObservation: proxy.snapshot,
		readBody: async () => ({ body: "", base64Encoded: false }),
	});
	collector.installed();
	collector.beginMeasurement();
	collector.request(event("inherited", 1));
	collector.failed({
		requestId: "inherited",
		errorText: "net::ERR_ABORTED",
		canceled: true,
	});
	collector.recordMeasuredFailure("not-yet-observed");
	collector.endMeasurement();
	collector.endScope();
	const proof = collector.snapshot();
	assert.equal(proof.measured.rawFailedRequests, 1);
	assert.equal(proof.measured.records[0].requestId, "not-yet-observed");
	assert.equal(proof.measured.unknownFailures, 1);
	assert.equal(proof.measured.complete, false);
	assert.equal(proof.allPhase.rawFailedRequests, 1);
});

test("passive stream bytes survive canceled getBody and prove only exact naturally completed proxy protocol", async () => {
	for (const mode of ["exact", "gap", "different-proxy-body", "late-ack"]) {
		const actionHeaders = { ...headers, "next-action": "b".repeat(40) };
		const bytes = Buffer.from(
			'0:{"a":"$@1","q":"","i":false}\n1:{"result":true}\n',
		);
		const prefix = bytes.subarray(0, 13),
			tail = bytes.subarray(13);
		const proxy = createProxyControlCollector({ contextId });
		proxy.installed();
		let acknowledge;
		const collector = createBrowserControlCollector({
			contextId,
			origin,
			browserRevision: chromiumSWRRevision,
			proxyObservation: proxy.snapshot,
			readBody: async () => {
				throw Error("NoData");
			},
			readStream: () =>
				new Promise((resolve) => {
					acknowledge = resolve;
				}),
		});
		collector.installed();
		collector.beginMeasurement();
		const request = event("post", 1);
		request.request.method = "POST";
		request.request.headers = actionHeaders;
		const id = `${"a".repeat(32)}.4`;
		proxy.request(id, {
			url,
			method: "POST",
			headers: actionHeaders,
			traceId: "a".repeat(32),
		});
		proxy.response(id, { status: 200, headers: responseHeaders });
		proxy.bytes(
			id,
			mode === "different-proxy-body"
				? Buffer.from(bytes.toString().replace("true", "false"))
				: bytes,
		);
		proxy.end(id);
		collector.request(request);
		collector.requestExtra({ requestId: "post", headers: actionHeaders });
		collector.response({
			requestId: "post",
			response: {
				status: 200,
				headers: { ...responseHeaders, [controlResponseHeader]: id },
			},
		});
		collector.data({ requestId: "post", dataLength: prefix.length });
		await Promise.resolve();
		collector.data({
			requestId: "post",
			dataLength: tail.length,
			data: tail.toString("base64"),
		});
		collector.recordMeasuredFailure("post");
		collector.failed({
			requestId: "post",
			errorText: "net::ERR_ABORTED",
			canceled: true,
		});
		acknowledge({
			bufferedData: mode === "gap" ? "" : prefix.toString("base64"),
		});
		collector.endMeasurement();
		if (mode !== "late-ack") await tick();
		collector.endScope();
		await tick();
		await tick();
		const proof = collector.snapshot();
		assert.equal(proof.measured.rawFailedRequests, 1);
		assert.equal(proof.measured.provenControls, mode === "exact" ? 1 : 0);
		assert.equal(proof.measured.unknownFailures, mode === "exact" ? 0 : 1);
		assert.equal(proof.bodyReceipts[0].bodyReadbackComplete, false);
		assert.equal(
			proof.bodyReceipts[0].streamReceipt.terminal,
			mode === "late-ack" ? "scope-ended" : "failed",
		);
	}
});
