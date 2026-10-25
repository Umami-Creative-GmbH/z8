/** Independent of exporter delivery: bounded numerical accounting at the SDK span lifecycle. */

import { writeFile } from "node:fs/promises";
import { createServer, IncomingMessage, type Server } from "node:http";
import { SpanKind } from "@opentelemetry/api";

type NativeKind = "queries" | "acquisitions" | "cache";
type NativeSpan = {
	name: string;
	kind?: number;
	instrumentationScope?: { name: string };
	spanContext(): { traceId: string };
};
type Counts = Record<NativeKind, number>;
const counts = (): Counts => ({ queries: 0, acquisitions: 0, cache: 0 });
const serverScopes = () => ({
	http: { started: 0, ended: 0 },
	next: { started: 0, ended: 0 },
	other: { started: 0, ended: 0 },
});
const serverScope = (
	span: NativeSpan,
): keyof ReturnType<typeof serverScopes> => {
	if (span.instrumentationScope?.name === "@opentelemetry/instrumentation-http")
		return "http";
	return span.instrumentationScope?.name === "next.js" ? "next" : "other";
};
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
		{
			started: Counts;
			ended: Counts;
			unknown: number;
			servers: number;
			serverStarted: number;
			serverEnded: number;
			serverScopes: ReturnType<typeof serverScopes>;
			lastActivity: number;
			driverQueries: number;
		}
	>();
	private readonly totals = { started: counts(), ended: counts(), unknown: 0 };
	private driverQueries = 0;
	private driverCounter = false;
	private readonly incoming = {
		knownHeaderKnownSpan: 0,
		knownHeaderOtherSpan: 0,
		otherHeaderKnownSpan: 0,
		otherHeaderOtherSpan: 0,
		matchingParent: 0,
		mismatchingParent: 0,
	};
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
				servers: 0,
				serverStarted: 0,
				serverEnded: 0,
				serverScopes: serverScopes(),
				lastActivity: performance.now(),
				driverQueries: 0,
			});
	}
	enableDriverCounter() {
		this.driverCounter = true;
	}
	driverQuery(traceId?: string) {
		this.driverQueries++;
		const state = traceId ? this.active.get(traceId) : undefined;
		if (state) {
			state.driverQueries++;
			state.lastActivity = performance.now();
		} else for (const window of this.active.values()) window.unknown++;
	}
	observeIncoming(
		span: { spanContext(): { traceId: string } },
		request: unknown,
	) {
		if (!(request instanceof IncomingMessage)) return;
		const parent = request.headers.traceparent;
		const parentId =
			typeof parent === "string"
				? /^00-([a-f0-9]{32})-[a-f0-9]{16}-0[01]$/i
						.exec(parent)?.[1]
						?.toLowerCase()
				: undefined;
		const spanId = span.spanContext().traceId;
		const headerKnown = parentId !== undefined && this.active.has(parentId);
		const spanKnown = this.active.has(spanId);
		this.incoming[
			headerKnown
				? spanKnown
					? "knownHeaderKnownSpan"
					: "knownHeaderOtherSpan"
				: spanKnown
					? "otherHeaderKnownSpan"
					: "otherHeaderOtherSpan"
		]++;
		if (parentId)
			this.incoming[
				parentId === spanId ? "matchingParent" : "mismatchingParent"
			]++;
	}
	onStart(span: NativeSpan) {
		const state = this.active.get(span.spanContext().traceId);
		if (span.kind === SpanKind.SERVER && state) {
			state.servers++;
			state.serverStarted++;
			state.serverScopes[serverScope(span)].started++;
			state.lastActivity = performance.now();
		}
		const kind = nativeKind(span);
		if (!kind) return;
		this.totals.started[kind]++;
		if (state) {
			state.started[kind]++;
			state.lastActivity = performance.now();
		} else {
			this.totals.unknown++;
			for (const window of this.active.values()) window.unknown++;
		}
	}
	onEnd(span: NativeSpan) {
		const state = this.active.get(span.spanContext().traceId);
		if (span.kind === SpanKind.SERVER && state) {
			state.servers--;
			state.serverEnded++;
			state.serverScopes[serverScope(span)].ended++;
			state.lastActivity = performance.now();
		}
		const kind = nativeKind(span);
		if (!kind) return;
		this.totals.ended[kind]++;
		if (state) {
			state.ended[kind]++;
			state.lastActivity = performance.now();
		} else for (const window of this.active.values()) window.unknown++;
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
				driverQueries: state.driverQueries,
				driverComplete:
					this.driverCounter && state.driverQueries === state.ended.queries,
				complete:
					state.unknown === 0 &&
					state.servers === 0 &&
					Object.keys(state.started).every(
						(key) =>
							state.started[key as NativeKind] ===
							state.ended[key as NativeKind],
					),
				serverBalance: state.servers,
				serverStarted: state.serverStarted,
				serverEnded: state.serverEnded,
				serverScopes: state.serverScopes,
				lastActivityAgeMs: performance.now() - state.lastActivity,
			};
		});
	}
	snapshot() {
		return {
			...this.totals,
			started: { ...this.totals.started },
			ended: { ...this.totals.ended },
			driverQueries: this.driverQueries,
			driverCounter: this.driverCounter,
			incoming: this.incoming,
			activeTraces: this.active.size,
		};
	}
	async drain(traceIds: string[]) {
		const deadline = performance.now() + 10000;
		while (performance.now() < deadline) {
			if (
				traceIds.every((traceId) => {
					const state = this.active.get(traceId);
					return (
						state &&
						state.servers === 0 &&
						performance.now() - state.lastActivity >= 500 &&
						Object.keys(state.started).every(
							(key) =>
								state.started[key as NativeKind] ===
								state.ended[key as NativeKind],
						)
					);
				})
			)
				return true;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return false;
	}
}

const wrappedDrivers = new WeakSet<object>();
/** Observe real client calls while preserving every overload's callback, promise and return behavior. */
export function installFixtureDriverCounter(
	driver: { prototype: object },
	coverage: FixtureNativeCoverage,
	activeTraceId: () => string | undefined,
) {
	if (wrappedDrivers.has(driver.prototype))
		throw new Error("Native driver counter already installed");
	for (const method of ["query", "execute"]) {
		const descriptor = Object.getOwnPropertyDescriptor(
			driver.prototype,
			method,
		);
		if (!descriptor || typeof descriptor.value !== "function")
			throw new Error("Native wire boundary unavailable");
		const original = descriptor.value;
		Object.defineProperty(driver.prototype, method, {
			...descriptor,
			value: function (this: unknown, ...args: unknown[]) {
				coverage.driverQuery(activeTraceId());
				return Reflect.apply(original, this, args);
			},
		});
	}
	wrappedDrivers.add(driver.prototype);
	coverage.enableDriverCounter();
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
				const drainStarted = performance.now();
				const drained = await coverage.drain(traceIds);
				const drainElapsedMs = performance.now() - drainStarted;
				await forceFlush();
				proof = coverage.close(traceIds).map((entry) => ({
					...entry,
					drained,
					drainElapsedMs,
					complete: entry.complete && entry.driverComplete && drained,
				}));
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
