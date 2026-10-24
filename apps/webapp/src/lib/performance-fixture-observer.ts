/** Optional benchmark observation on the existing OTel seam; never a source of authorization or data. */
import { type Context, type Span, SpanKind, trace } from "@opentelemetry/api";
import type {
	ReadableSpan,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { CacheHandler } from "next/cache";
import { getCacheHandler } from "next/dist/server/use-cache/handlers";
import nextPackage from "next/package.json";
import type { FixtureNativeCoverage } from "./performance-fixture-native-coverage";

export const fixtureObserverVersion = 2;
export const eventLoopProbeIntervalMs = 10;
const retainedProbes = 30000;
const observedHandlers = new WeakSet<CacheHandler>();

/** Preserve the installed native handler object: custom registration changes Next's built-in reuse rules. */
function observeNextDefaultCache(): boolean {
	if (nextPackage.version !== "16.4.0") return false;
	let handler: CacheHandler | undefined;
	try {
		handler = getCacheHandler("default");
	} catch {
		return false;
	}
	if (!handler) return false;
	if (observedHandlers.has(handler)) return true;
	const original = handler.get.bind(handler);
	handler.get = (key, softTags) =>
		trace
			.getTracer("z8-fixture-cache")
			.startActiveSpan("fixture.cache.get", async (span) => {
				try {
					const entry = await original(key, softTags);
					span.setAttribute("z8.perf.cache.hit", entry !== undefined);
					return entry;
				} catch (error) {
					span.setStatus({ code: 2 });
					throw error;
				} finally {
					span.end();
				}
			});
	observedHandlers.add(handler);
	return true;
}

/** Numeric results only. In particular, never attach the query text, parameters or row contents. */
export function observeFixturePgResponse(
	span: Span,
	response: { data: { rows: unknown[]; rowCount: number | null } },
) {
	if (Array.isArray(response.data?.rows))
		span.setAttribute("db.response.returned_rows", response.data.rows.length);
	if (
		Number.isSafeInteger(response.data?.rowCount) &&
		response.data.rowCount !== null &&
		response.data.rowCount >= 0
	)
		span.setAttribute("db.response.affected_rows", response.data.rowCount);
}

/** Scheduling lateness of 10ms probes completing during each server span, including concurrent host work. */
export class FixturePerformanceSpanProcessor implements SpanProcessor {
	private readonly windows = new Map<string, number>();
	private readonly delays: number[] = [];
	private sequence = 0;
	private lastProbe = performance.now();
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(
		private readonly delegate: SpanProcessor,
		private readonly nativeCoverage?: FixtureNativeCoverage,
	) {
		this.timer = setInterval(() => {
			const now = performance.now();
			this.delays[this.sequence % retainedProbes] = Math.max(
				0,
				now - this.lastProbe - eventLoopProbeIntervalMs,
			);
			this.lastProbe = now;
			this.sequence++;
		}, eventLoopProbeIntervalMs);
		this.timer.unref();
	}

	onStart(
		span: Parameters<SpanProcessor["onStart"]>[0],
		parentContext: Context,
	) {
		this.nativeCoverage?.onStart(span);
		if (span.kind === SpanKind.SERVER) {
			this.windows.set(span.spanContext().spanId, this.sequence);
			span.setAttribute("z8.perf.cache.coverage", observeNextDefaultCache());
		}
		this.delegate.onStart(span, parentContext);
	}

	onEnd(span: ReadableSpan) {
		this.nativeCoverage?.onEnd(span);
		const start = this.windows.get(span.spanContext().spanId);
		this.windows.delete(span.spanContext().spanId);
		if (start === undefined) {
			this.delegate.onEnd(span);
			return;
		}
		const count = Math.min(this.sequence - start, retainedProbes);
		let maximum = 0;
		for (let index = this.sequence - count; index < this.sequence; index++)
			maximum = Math.max(maximum, this.delays[index % retainedProbes] ?? 0);
		const attributes = {
			...span.attributes,
			"z8.perf.event_loop.probes": count,
			"z8.perf.event_loop.complete": this.sequence - start <= retainedProbes,
			...(count > 0 ? { "z8.perf.event_loop.max_delay_ms": maximum } : {}),
		};
		// ReadableSpan has ended. Supply exporter metadata without mutating the ended SDK span.
		this.delegate.onEnd(
			new Proxy(span, {
				get(target, property) {
					if (property === "attributes") return attributes;
					const value = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			}),
		);
	}

	forceFlush() {
		return this.delegate.forceFlush();
	}
	shutdown() {
		clearInterval(this.timer);
		this.windows.clear();
		return this.delegate.shutdown();
	}
}
