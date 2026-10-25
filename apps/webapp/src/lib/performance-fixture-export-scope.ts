import { AsyncResource } from "node:async_hooks";
import { context } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

/** Created during instrumentation startup, before any Next render context exists. */
export function isolateFixtureExporter<T extends SpanExporter>(exporter: T): T {
	const startup = new AsyncResource("z8-fixture-export");
	const original = exporter.export;
	exporter.export = function (this: T, ...args) {
		const parent = context.active();
		return startup.runInAsyncScope(() =>
			context.with(parent, () => original.apply(this, args)),
		);
	};
	return exporter;
}
