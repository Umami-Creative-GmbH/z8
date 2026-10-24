/** Per-browser-context causal transport, including ServiceWorker traffic. Never inspects or saves payloads. */
import { randomBytes } from "node:crypto";
import { Agent, createServer, request as forward } from "node:http";
import { createProxyWireObserver } from "./proxy-wire-observer.mjs";

export const fixtureTraceTransport = "context-loopback-proxy-v1";
const loopback = (url) =>
	url.protocol === "http:" &&
	["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
	!url.username &&
	!url.password;
export async function createFixtureTraceTransport({
	origin,
	getTraceId,
	allowedOrigins = [origin],
}) {
	const target = new URL(origin);
	if (!loopback(target) || target.origin !== origin)
		throw new Error("Fixture trace transport requires a loopback HTTP origin.");
	if (
		!Array.isArray(allowedOrigins) ||
		!allowedOrigins.includes(origin) ||
		allowedOrigins.some((value) => {
			const url = new URL(value);
			return !loopback(url) || url.origin !== value;
		})
	)
		throw new Error(
			"Trace transport requires an explicit owned loopback origin allowlist.",
		);
	const allowed = new Set(allowedOrigins);
	const agent = new Agent({ keepAlive: true, maxSockets: 64 });
	const wire = createProxyWireObserver();
	const counts = {
		requests: 0,
		rewrittenRequests: 0,
		refusedRequests: 0,
		upstreamFailures: 0,
		responseBodyBytes: 0,
		refusalReasons: { unexpectedLoopback: 0, nonLoopbackHttp: 0, loopbackConnect: 0, nonLoopbackConnect: 0, malformed: 0 },
	};
	const server = createServer((request, response) => {
		let wireId;
		try {
			const traceId = getTraceId({
				headers: request.headers,
				method: request.method,
			});
			if (!/^[a-f0-9]{32}$/.test(traceId))
				throw new Error("Missing registered context identity");
			wireId = wire.request(
				{ traceId, headers: request.headers },
				performance.now(),
			);
			const url = new URL(request.url, origin);
			if (!loopback(url) || !allowed.has(url.origin)) {
				counts.refusedRequests++;
				counts.refusalReasons[loopback(url) ? "unexpectedLoopback" : "nonLoopbackHttp"]++;
				wire.end(wireId, { error: true }, performance.now());
				response.writeHead(403).end();
				return;
			}
			counts.requests++;
			const headers = { ...request.headers };
			delete headers["proxy-connection"];
			delete headers["proxy-authorization"];
			if (url.origin === origin) {
				headers.traceparent = `00-${traceId}-${randomBytes(8).toString("hex")}-01`;
				counts.rewrittenRequests++;
			}
			const upstream = forward(
				url,
				{ method: request.method, headers, agent },
				(answer) => {
					wire.response(
						wireId,
						{
							mimeType: answer.headers["content-type"],
							status: answer.statusCode,
							redirect:
								answer.statusCode >= 300 &&
								answer.statusCode < 400 &&
								answer.headers.location !== undefined,
						},
						performance.now(),
					);
					answer.on("data", (chunk) => {
						counts.responseBodyBytes += chunk.length;
						wire.bytes(wireId, chunk.length, performance.now());
					});
					answer.once("end", () => wire.end(wireId, {}, performance.now()));
					answer.once("aborted", () =>
						wire.end(wireId, { error: true }, performance.now()),
					);
					answer.once("error", () =>
						wire.end(wireId, { error: true }, performance.now()),
					);
					response.writeHead(answer.statusCode ?? 502, answer.headers);
					answer.pipe(response);
				},
			);
			let downstreamAborted = false;
			upstream.on("error", () => {
				if (!downstreamAborted) counts.upstreamFailures++;
				wire.end(wireId, { error: true }, performance.now());
				if (!response.headersSent) response.writeHead(502);
				response.end();
			});
			request.on("aborted", () => {
				wire.end(wireId, { error: true }, performance.now());
				upstream.destroy();
			});
			response.on("close", () => {
				if (!response.writableEnded) {
					downstreamAborted = true;
					upstream.destroy();
				}
			});
			request.pipe(upstream);
		} catch {
			counts.refusedRequests++;
			counts.refusalReasons.malformed++;
			if (wireId !== undefined)
				wire.end(wireId, { error: true }, performance.now());
			response.writeHead(400).end();
		}
	});
	server.on("connect", (_request, socket) => {
		socket.on("error", () => {}); // Client cancellation must not crash the owning harness.
		counts.refusedRequests++;
		try {
			const destination = new URL(`https://${_request.url}`);
			counts.refusalReasons[["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname) ? "loopbackConnect" : "nonLoopbackConnect"]++;
		} catch { counts.refusalReasons.malformed++; }
		try {
			const traceId = getTraceId({
				headers: _request.headers,
				method: _request.method,
			});
			const id = wire.request(
				{ traceId, headers: _request.headers },
				performance.now(),
			);
			wire.end(id, { error: true }, performance.now());
		} catch {}
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
	});
	server.on("clientError", (_error, socket) => socket.destroy());
	server.requestTimeout = 0; // Streaming duration belongs to the existing journey deadline.
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	let closed = false;
	return {
		wire,
		browserContextOptions: {
			proxyServer: `http://127.0.0.1:${server.address().port}`,
			proxyBypassList: ["<-loopback>"],
		},
		snapshot: () => ({ ...counts, refusalReasons: { ...counts.refusalReasons } }),
		async close() {
			if (closed) return;
			closed = true;
			agent.destroy();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
