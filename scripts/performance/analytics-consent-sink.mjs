/** Real SDK traffic terminates here. Bodies, headers, query values and identities are never retained. */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
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
	if (
		method === "GET" &&
		[
			"/api/product_tours",
			"/api/product_tours/",
			"/api/surveys",
			"/api/surveys/",
		].includes(pathname)
	)
		return {
			status: 200,
			bucket: "sdkDefinitions",
			type: "application/json",
			body: pathname.includes("product_tours")
				? '{"product_tours":[]}'
				: '{"surveys":[]}',
		};
	const asset = ["surveys.js", "product-tours.js", "conversations.js"].find(
		(name) =>
			pathname === `/static/${name}` || pathname === `/static/1.438.7/${name}`,
	);
	if (method === "GET" && asset)
		return {
			status: 200,
			bucket: "sdkAssets",
			type: "application/javascript",
			asset,
		};
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
	if (
		method === "POST" &&
		["/flags/", "/decide/", "/flags", "/decide"].includes(pathname)
	)
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
		[
			"/e/",
			"/i/v0/e/",
			"/batch/",
			"/s/",
			"/e",
			"/i/v0/e",
			"/batch",
			"/s",
		].includes(pathname)
	)
		return {
			status: 200,
			bucket: ["/s/", "/s"].includes(pathname) ? "recording" : "capture",
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
		sdkAssets: 0,
		sdkDefinitions: 0,
		assetFailures: 0,
		assetResponseBytes: 0,
		flags: 0,
		capture: 0,
		recording: 0,
		unexpected: 0,
		blockedProxy: 0,
		requestBytes: 0,
		oversized: 0,
		socketErrors: 0,
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
			void (async () => {
				let body = reply.body;
				const headers = {
					"content-type": reply.type,
					"cache-control": "no-store",
				};
				if (reply.asset) {
					const source = await readFile(
						join(
							fixture.artifactApp,
							"node_modules/posthog-js/dist",
							reply.asset,
						),
					);
					if (source.length > 2 * 1024 * 1024)
						throw new Error("Unexpected SDK asset size.");
					body = source;
					if (request.headers["accept-encoding"]?.includes("gzip")) {
						body = gzipSync(source);
						headers["content-encoding"] = "gzip";
					}
					counts.assetResponseBytes += body.length;
				}
				response.writeHead(reply.status, headers);
				response.end(body);
			})().catch(() => {
				counts.assetFailures++;
				response.writeHead(503, { "content-type": "application/json" });
				response.end("{}");
			});
		});
		request.on("error", () => {});
	});
	server.on("connect", (_request, socket) => {
		counts.blockedProxy++;
		socket.on("error", () => {
			counts.socketErrors++;
		});
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
