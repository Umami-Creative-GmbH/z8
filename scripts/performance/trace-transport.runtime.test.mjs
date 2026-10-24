/** Installed Chromium/ServiceWorker oracle; owns every browser context and loopback server it creates. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { createFixtureTraceTransport } from "./trace-transport.mjs";

test("two concurrent worker contexts preserve encoded gzip bytes and agree with the independent server oracle", {
	timeout: 20000,
}, async () => {
	assert.ok(
		process.env.Z8_TEST_CHROME_PATH,
		"Explicit installed Chrome path required.",
	);
	const require = createRequire(
		new URL("../../apps/webapp/package.json", import.meta.url),
	);
	const puppeteer = require("puppeteer-core");
	const plain = Buffer.from("self.fixturePayload = true;\n".repeat(2048)),
		encoded = gzipSync(plain);
	const worker = Buffer.from(
		`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>e.waitUntil(fetch('/compressed-script.js').then(r=>r.text()).then(t=>{if(t.length!==${plain.length})throw Error('length');e.source.postMessage('complete');})));`,
	);
	const html = Buffer.from(
		`<!doctype html><link rel="icon" href="data:,"><script>navigator.serviceWorker.addEventListener('message',e=>{if(e.data==='complete')window.complete=true;});(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));navigator.serviceWorker.controller.postMessage('fetch');})();</script>`,
	);
	const ids = ["a".repeat(32), "b".repeat(32)];
	const oracle = ids.map(() => ({
		javascript: 0,
		document: 0,
		otherFinite: 0,
	}));
	let workerGzipRequests = 0;
	const server = createServer((request, response) => {
		const trace = /^00-([a-f0-9]{32})-/.exec(
			request.headers.traceparent ?? "",
		)?.[1];
		const index = ids.indexOf(trace);
		assert.ok(
			index >= 0,
			"Every worker and page request retains its own context identity",
		);
		let body = html,
			mime = "text/html",
			group = "document";
		if (request.url === "/sw.js") {
			body = worker;
			mime = "application/javascript";
			group = "javascript";
		} else if (request.url === "/compressed-script.js") {
			body = encoded;
			mime = "application/javascript";
			group = "javascript";
			response.setHeader("Content-Encoding", "gzip");
			workerGzipRequests++;
		}
		oracle[index][group] += body.length;
		response.writeHead(200, {
			"Content-Type": mime,
			"Content-Length": body.length,
			"Cache-Control": "no-store",
		});
		response.end(body);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	let browser;
	const transports = [];
	try {
		browser = await puppeteer.launch({
			executablePath: process.env.Z8_TEST_CHROME_PATH,
			headless: true,
		});
		const proof = await Promise.all(
			ids.map(async (traceId, index) => {
				const transport = await createFixtureTraceTransport({
					origin,
					getTraceId: () => traceId,
				});
				transports.push(transport);
				const context = await browser.createBrowserContext(
					transport.browserContextOptions,
				);
				const page = await context.newPage();
				transport.wire.begin(performance.now());
				await page.goto(origin);
				await page.waitForFunction(() => window.complete === true, {
					timeout: 10000,
				});
				transport.wire.ready(performance.now());
				let state = transport.wire.state(performance.now());
				while (!state.complete && !state.capped) {
					await pause(50);
					state = transport.wire.state(performance.now());
				}
				if (!state.complete)
					console.log(
						JSON.stringify({
							index,
							mandatoryPending: state.mandatoryPending,
							mandatoryErrors: state.mandatoryErrors,
							refusedRequests: transport.snapshot().refusedRequests,
							javascriptBodyBytes: state.bytes.javascript,
							serverJavascriptBodyBytes: oracle[index].javascript,
							documentBodyBytes: state.bytes.document,
							serverDocumentBodyBytes: oracle[index].document,
							workerGzipRequests,
						}),
					);
				assert.equal(state.complete, true);
				assert.equal(state.bytes.javascript, oracle[index].javascript);
				assert.equal(state.bytes.document, oracle[index].document);
				assert.equal(state.bytes.otherFinite, 0);
				assert.equal(state.bytes.rsc, 0);
				assert.equal(state.byTrace.length, 1);
				assert.equal(state.byTrace[0].traceId, traceId);
				assert.equal(state.bytes.javascript, worker.length + encoded.length);
				assert.ok(encoded.length < plain.length);
				await context.close();
				return {
					javascriptBodyBytes: state.bytes.javascript,
					serverJavascriptBodyBytes: oracle[index].javascript,
					documentBodyBytes: state.bytes.document,
					wireTotal: transport.snapshot().responseBodyBytes,
					complete: state.complete,
				};
			}),
		);
		assert.equal(workerGzipRequests, 2);
		console.log(
			JSON.stringify({
				workerGzipRequests,
				compressedFixtureBytes: encoded.length,
				decodedFixtureBytes: plain.length,
				perContext: proof,
			}),
		);
	} finally {
		await browser?.close();
		await Promise.all(transports.map((transport) => transport.close()));
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});
