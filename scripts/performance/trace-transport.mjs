/** Per-browser-context causal transport, including ServiceWorker traffic. Never inspects or saves payloads. */
import { randomBytes } from "node:crypto";
import { Agent, createServer, request as forward } from "node:http";

export const fixtureTraceTransport = "context-loopback-proxy-v1";
const loopback = (url) =>
	url.protocol === "http:" &&
	["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
	!url.username &&
	!url.password;
export async function createFixtureTraceTransport({ origin, getTraceId }) {
	const target = new URL(origin);
	if (!loopback(target) || target.origin !== origin)
		throw new Error("Fixture trace transport requires a loopback HTTP origin.");
	const agent = new Agent({ keepAlive: true, maxSockets: 64 });
	const counts = {
		requests: 0,
		rewrittenRequests: 0,
		refusedRequests: 0,
		upstreamFailures: 0,
	};
	const server = createServer((request, response) => {
		try {
			const url = new URL(request.url, origin);
			if (!loopback(url)) {
				counts.refusedRequests++;
				response.writeHead(403).end();
				return;
			}
			counts.requests++;
			const headers = { ...request.headers };
			delete headers["proxy-connection"];
			delete headers["proxy-authorization"];
			if (url.origin === origin) {
				const traceId = getTraceId({headers:request.headers,method:request.method});
				if (!/^[a-f0-9]{32}$/.test(traceId))
					throw new Error("Missing registered context identity");
				headers.traceparent = `00-${traceId}-${randomBytes(8).toString("hex")}-01`;
				counts.rewrittenRequests++;
			}
			const upstream = forward(
				url,
				{ method: request.method, headers, agent },
				(answer) => {
					response.writeHead(answer.statusCode ?? 502, answer.headers);
					answer.pipe(response);
				},
			);
			upstream.on("error", () => {
				counts.upstreamFailures++;
				if (!response.headersSent) response.writeHead(502);
				response.end();
			});
			request.on("aborted", () => upstream.destroy());
			response.on("close", () => {
				if (!response.writableEnded) upstream.destroy();
			});
			request.pipe(upstream);
		} catch {
			counts.refusedRequests++;
			response.writeHead(400).end();
		}
	});
	server.on("connect", (_request, socket) => {
		counts.refusedRequests++;
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
		browserContextOptions: {
			proxyServer: `http://127.0.0.1:${server.address().port}`,
			proxyBypassList: ["<-loopback>"],
		},
		snapshot: () => ({ ...counts }),
		async close() {
			if (closed) return;
			closed = true;
			agent.destroy();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
