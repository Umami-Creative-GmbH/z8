import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
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
		});
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
