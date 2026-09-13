import type {
	ReadableSpan,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { SETUP_REQUEST_PATH, SetupPrivacySpanProcessor } from "./telemetry";

describe("setup credential telemetry privacy", () => {
	it.each([
		{
			name: "GET",
			attributes: { "url.full": "https://example.com/de/setup?code=secret" },
		},
		{ name: "GET /api/setup/authorize", attributes: {} },
		{
			name: "redis-eval",
			attributes: {
				"db.statement": "eval script 2 z8:{setup-bootstrap}:code secret",
			},
		},
	])("never exports setup HTTP or Redis spans: $name", (span) => {
		const delegate = { onEnd: vi.fn() } as unknown as SpanProcessor;
		const processor = new SetupPrivacySpanProcessor(delegate);
		processor.onEnd(span as unknown as ReadableSpan);
		expect(delegate.onEnd).not.toHaveBeenCalled();
	});

	it("preserves ordinary request spans", () => {
		const delegate = { onEnd: vi.fn() } as unknown as SpanProcessor;
		const span = {
			name: "GET /dashboard",
			attributes: {},
		} as unknown as ReadableSpan;
		new SetupPrivacySpanProcessor(delegate).onEnd(span);
		expect(delegate.onEnd).toHaveBeenCalledWith(span);
	});

	it("excludes all setup URL variants from ordinary request logging", () => {
		for (const path of [
			"/setup?code=secret",
			"/de/setup?code=secret",
			"/gsw/setup?code=secret",
			"/api/setup/authorize?code=secret",
		]) {
			expect(SETUP_REQUEST_PATH.test(path)).toBe(true);
		}
		expect(SETUP_REQUEST_PATH.test("/settings/setup-guide")).toBe(false);
	});
});
