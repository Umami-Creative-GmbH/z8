/** Independent of exporter delivery: bounded numerical accounting at the SDK span lifecycle. */

import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";

type NativeKind = "queries" | "acquisitions" | "cache";
type NativeSpan = {
	name: string;
	instrumentationScope?: { name: string };
	spanContext(): { traceId: string };
};
type Counts = Record<NativeKind, number>;
const counts = (): Counts => ({ queries: 0, acquisitions: 0, cache: 0 });
const nativeKind = (span: NativeSpan): NativeKind | undefined => {
	if (span.instrumentationScope?.name === "@opentelemetry/instrumentation-pg") {
		if (span.name.startsWith("pg.query")) return "queries";
		if (span.name === "pg-pool.connect") return "acquisitions";
	}
	if (
		span.instrumentationScope?.name === "z8-fixture-cache" &&
		span.name === "fixture.cache.get"
	)
		return "cache";
};
export class FixtureNativeCoverage {
	private readonly active = new Map<
		string,
		{ started: Counts; ended: Counts; unknown: number }
	>();
	private readonly totals = { started: counts(), ended: counts(), unknown: 0 };
	register(traceIds: string[]) {
		if (
			!Array.isArray(traceIds) ||
			traceIds.length === 0 ||
			new Set(traceIds).size !== traceIds.length ||
			this.active.size + traceIds.length > 64 ||
			traceIds.some(
				(value) => !/^[a-f0-9]{32}$/.test(value) || this.active.has(value),
			)
		)
			throw new Error("Invalid native registration");
		for (const value of traceIds)
			this.active.set(value, {
				started: counts(),
				ended: counts(),
				unknown: 0,
			});
	}
	onStart(span: NativeSpan) {
		const kind = nativeKind(span);
		if (!kind) return;
		this.totals.started[kind]++;
		const state = this.active.get(span.spanContext().traceId);
		if (state) state.started[kind]++;
		else {
			this.totals.unknown++;
			for (const window of this.active.values()) window.unknown++;
		}
	}
	onEnd(span: NativeSpan) {
		const kind = nativeKind(span);
		if (!kind) return;
		this.totals.ended[kind]++;
		const state = this.active.get(span.spanContext().traceId);
		if (state) state.ended[kind]++;
		else for (const window of this.active.values()) window.unknown++;
	}
	close(traceIds: string[]) {
		if (
			!Array.isArray(traceIds) ||
			traceIds.length === 0 ||
			new Set(traceIds).size !== traceIds.length ||
			traceIds.some((value) => !this.active.has(value))
		)
			throw new Error("Unknown native registration");
		return traceIds.map((traceId) => {
			const state = this.active.get(traceId);
			if (!state) throw new Error("Unknown native registration");
			this.active.delete(traceId);
			return {
				traceId,
				...state.ended,
				started: state.started,
				ended: state.ended,
				unattributedNativeSpans: state.unknown,
				complete:
					state.unknown === 0 &&
					Object.keys(state.started).every(
						(key) =>
							state.started[key as NativeKind] ===
							state.ended[key as NativeKind],
					),
			};
		});
	}
	snapshot() {
		return { ...this.totals, activeTraces: this.active.size };
	}
}

/** Created only by the existing loopback fixture-observer opt-in. No app routes or database access. */
export async function startFixtureNativeControl(
	coverage: FixtureNativeCoverage,
	forceFlush: () => Promise<void>,
	control: string,
): Promise<Server> {
	const server = createServer(async (request, response) => {
		try {
			if (request.method === "GET" && request.url === "/counters") {
				response.setHeader("Content-Type", "application/json");
				response.end(
					JSON.stringify({
						protocol: "z8-fixture-native-observer-v2",
						...coverage.snapshot(),
					}),
				);
				return;
			}
			if (
				request.method !== "POST" ||
				!["/visits/register", "/visits/close"].includes(request.url ?? "")
			) {
				response.writeHead(404).end();
				return;
			}
			let text = "";
			for await (const chunk of request) {
				text += chunk.toString();
				if (text.length > 16384)
					throw new Error("Oversized native control body");
			}
			const { traceIds } = JSON.parse(text);
			let proof: ReturnType<FixtureNativeCoverage["close"]> = [];
			if (request.url === "/visits/register") coverage.register(traceIds);
			else {
				await forceFlush();
				proof = coverage.close(traceIds);
			}
			response.setHeader("Content-Type", "application/json");
			response.end(
				JSON.stringify({ protocol: "z8-fixture-native-observer-v2", proof }),
			);
		} catch {
			response.writeHead(400).end("Invalid native control operation");
		}
	});
	server.requestTimeout = 15000;
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No native control interface");
	await writeFile(
		control,
		JSON.stringify({
			protocol: "z8-fixture-native-observer-v2",
			pid: process.pid,
			endpoint: `http://127.0.0.1:${address.port}`,
		}),
		{ mode: 0o600 },
	);
	server.unref();
	return server;
}
