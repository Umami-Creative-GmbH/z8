import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createFixtureTraceTransport } from "./trace-transport.mjs";

test("context transport preserves streaming, cookies, bodies and phase identity without retaining payloads", async () => {
	let firstChunk;
	const first = new Promise((resolve) => {
		firstChunk = resolve;
	});
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let seen;
	const backend = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		seen = {
			parent: req.headers.traceparent,
			cookie: req.headers.cookie,
			body: Buffer.concat(chunks).toString(),
		};
		res.setHeader("Content-Type", "text/x-component");
		res.setHeader("Set-Cookie", "fixture-preserved=1; HttpOnly");
		res.write("first");
		await gate;
		res.end("second");
	});
	await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	let traceId = "a".repeat(32);
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => traceId,
	});
	try {
		transport.wire.begin(performance.now());
		traceId = "b".repeat(32);
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const done = new Promise((resolve, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/stream`,
					method: "POST",
					headers: { cookie: "PRIVATE_COOKIE_CANARY" },
				},
				(answer) => {
					const chunks = [];
					assert.equal(answer.headers["content-type"], "text/x-component");
					assert.deepEqual(answer.headers["set-cookie"], [
						"fixture-preserved=1; HttpOnly",
					]);
					answer.on("data", (chunk) => {
						chunks.push(chunk);
						firstChunk();
					});
					answer.on("end", () => resolve(Buffer.concat(chunks).toString()));
				},
			);
			call.once("error", reject);
			call.end("PRIVATE_BODY_CANARY");
		});
		await first;
		transport.wire.ready(performance.now());
		assert.equal(
			transport.wire.state(performance.now() + 2000).complete,
			false,
			"A live finite response cannot settle before its last chunk",
		);
		assert.equal(seen.cookie, "PRIVATE_COOKIE_CANARY");
		assert.equal(seen.body, "PRIVATE_BODY_CANARY");
		assert.ok(seen.parent.startsWith(`00-${traceId}-`));
		release();
		assert.equal(await done, "firstsecond");
		assert.deepEqual(transport.snapshot(), {
			requests: 1,
			rewrittenRequests: 1,
			refusedRequests: 0,
			upstreamFailures: 0,
			responseBodyBytes: 11,
		});
		const wire = transport.wire.state(performance.now() + 1001);
		assert.equal(wire.complete, true);
		assert.equal(wire.bytes.rsc, 11);
		assert.equal(wire.groups.rsc.observedBodyBytes, 11);
		assert.equal(wire.byTrace[0].traceId, traceId);
		assert.doesNotMatch(
			JSON.stringify(transport.snapshot()),
			/PRIVATE_|127\.0\.0\.1/,
		);
	} finally {
		release();
		await transport.close();
		backend.closeAllConnections();
		await new Promise((resolve) => backend.close(resolve));
	}
});

test("proxy wire oracle preserves gzip and counts encoded body bytes without HTTP headers", async () => {
	const plain = Buffer.from("const fixture = 1;\n".repeat(1000));
	const encoded = gzipSync(plain);
	const backend = createServer((_request, response) => {
		response.writeHead(200, {
			"Content-Type": "application/javascript",
			"Content-Encoding": "gzip",
			"Content-Length": encoded.length,
		});
		response.end(encoded);
	});
	await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "a".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const actual = await new Promise((resolve, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/chunk.js`,
				},
				(response) => {
					assert.equal(response.headers["content-encoding"], "gzip");
					const chunks = [];
					response.on("data", (chunk) => chunks.push(chunk));
					response.on("end", () => resolve(Buffer.concat(chunks)));
				},
			);
			call.on("error", reject);
			call.end();
		});
		assert.deepEqual(actual, encoded);
		transport.wire.ready(performance.now());
		const state = transport.wire.state(performance.now() + 1001);
		assert.equal(state.complete, true);
		assert.equal(state.bytes.javascript, encoded.length);
		assert.ok(state.bytes.javascript < plain.length);
		assert.equal(transport.snapshot().responseBodyBytes, encoded.length);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((resolve) => backend.close(resolve));
	}
});

test("unexpected loopback origins are refused before forwarding and explicit owned storage stays measured", async () => {
	let unownedRequests = 0,
		storageTrace;
	const app = createServer((_req, res) => res.end("app"));
	const unowned = createServer((_req, res) => {
		unownedRequests++;
		res.end("unowned");
	});
	const storage = createServer((req, res) => {
		storageTrace = req.headers.traceparent;
		res.end("store");
	});
	for (const server of [app, unowned, storage])
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${app.address().port}`,
		other = `http://127.0.0.1:${unowned.address().port}`,
		owned = `http://127.0.0.1:${storage.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "a".repeat(32),
		allowedOrigins: [origin, owned],
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const send = (url) =>
			new Promise((resolve, reject) => {
				const call = request(
					{ hostname: proxy.hostname, port: proxy.port, path: url },
					(answer) => {
						answer.resume();
						answer.on("end", () => resolve(answer.statusCode));
					},
				);
				call.on("error", reject);
				call.end();
			});
		assert.equal(await send(other), 403);
		assert.equal(unownedRequests, 0);
		assert.equal(await send(owned), 200);
		assert.equal(
			storageTrace,
			undefined,
			"Additional owned origins do not receive the application trace header",
		);
		transport.wire.ready(performance.now());
		const state = transport.wire.state(performance.now() + 1001);
		assert.equal(state.complete, false);
		assert.equal(state.mandatoryErrors, 1);
		assert.equal(state.bytes.otherFinite, 5);
		assert.equal(transport.snapshot().refusedRequests, 1);
	} finally {
		await transport.close();
		for (const server of [app, unowned, storage]) {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		}
	}
});
