/** Real SDK traffic terminates here. Bodies, headers, query values and identities are never retained. */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	fixtureToken,
	readAnalyticsFixture,
} from "./analytics-consent-fixture.mjs";

const config = {
	hasFeatureFlags: false,
	sessionRecording: false,
	surveys: [],
	productTours: [],
	siteApps: [],
};
export function sinkReply(path, method) {
	if (!path.startsWith("/") || path.startsWith("//"))
		return {
			status: 403,
			bucket: "blockedProxy",
			type: "application/json",
			body: "{}",
		};
	const pathname = new URL(path, "http://localhost").pathname;
	if (method === "GET" && pathname === `/array/${fixtureToken}/config.js`)
		return {
			status: 200,
			bucket: "config",
			type: "application/javascript",
			body: `window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(fixtureToken)}]={config:${JSON.stringify(config)}};`,
		};
	if (method === "GET" && pathname === `/array/${fixtureToken}/config`)
		return {
			status: 200,
			bucket: "config",
			type: "application/json",
			body: JSON.stringify(config),
		};
	if (method === "POST" && ["/flags/", "/decide/"].includes(pathname))
		return {
			status: 200,
			bucket: "flags",
			type: "application/json",
			body: JSON.stringify({
				flags: {},
				featureFlags: {},
				featureFlagPayloads: {},
				errorsWhileComputingFlags: false,
			}),
		};
	if (
		method === "POST" &&
		["/e/", "/i/v0/e/", "/batch/", "/s/"].includes(pathname)
	)
		return {
			status: 200,
			bucket: pathname === "/s/" ? "recording" : "capture",
			type: "application/json",
			body: '{"status":1}',
		};
	return {
		status: 404,
		bucket: "unexpected",
		type: "application/json",
		body: "{}",
	};
}
export async function startAnalyticsSink(directory) {
	const fixture = await readAnalyticsFixture(directory);
	const counts = {
		config: 0,
		flags: 0,
		capture: 0,
		recording: 0,
		unexpected: 0,
		blockedProxy: 0,
		requestBytes: 0,
		oversized: 0,
	};
	const server = createServer((request, response) => {
		if (request.method === "GET" && request.url === "/__fixture_metrics") {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify(counts));
			return;
		}
		const reply = sinkReply(request.url, request.method);
		counts[reply.bucket]++;
		let bytes = 0;
		request.on("data", (chunk) => {
			bytes += chunk.length;
			counts.requestBytes += chunk.length;
			if (bytes > 16 * 1024 * 1024) {
				counts.oversized++;
				request.destroy();
			}
		});
		request.on("end", () => {
			response.writeHead(reply.status, {
				"content-type": reply.type,
				"cache-control": "no-store",
			});
			response.end(reply.body);
		});
		request.on("error", () => {});
	});
	server.on("connect", (_request, socket) => {
		counts.blockedProxy++;
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
	});
	server.requestTimeout = 10000;
	await new Promise((done, reject) => {
		server.once("error", reject);
		server.listen(Number(new URL(fixture.sinkOrigin).port), "127.0.0.1", done);
	});
	return server;
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	startAnalyticsSink(process.argv[2]).then(
		() => console.log("Count-only fixture sink ready."),
		() => {
			console.error("Fixture sink refused to start.");
			process.exitCode = 1;
		},
	);
