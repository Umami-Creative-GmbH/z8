import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	initializeStorage: vi.fn(async () => ({ success: true })),
	runStartupChecks: vi.fn(async () => true),
	sdkStart: vi.fn(),
}));

vi.mock("@opentelemetry/api", () => ({
	SpanStatusCode: { ERROR: 2 },
}));
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
	getNodeAutoInstrumentations: vi.fn(() => []),
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
	OTLPTraceExporter: class {},
}));
vi.mock("@opentelemetry/resources", () => ({
	resourceFromAttributes: vi.fn(() => ({})),
}));
vi.mock("@opentelemetry/sdk-node", () => ({
	NodeSDK: class {
		start = mocks.sdkStart;
		shutdown = vi.fn(async () => undefined);
	},
}));
vi.mock("@opentelemetry/sdk-trace-base", () => ({
	BatchSpanProcessor: class {},
	ConsoleSpanExporter: class {
		export = vi.fn();
		shutdown = vi.fn(async () => undefined);
		forceFlush = vi.fn(async () => undefined);
	},
}));
vi.mock("@opentelemetry/semantic-conventions", () => ({
	ATTR_SERVICE_NAME: "service.name",
}));
vi.mock("@/lib/storage/storage-init", () => ({
	initializeStorage: mocks.initializeStorage,
}));
vi.mock("@/lib/health", () => ({
	runStartupChecks: mocks.runStartupChecks,
}));

import { register } from "./instrumentation";

describe("instrumentation registration", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("does not initialize external storage during a production build", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("NEXT_PHASE", "phase-production-build");
		vi.stubEnv("NODE_ENV", "production");

		await register();

		expect(mocks.sdkStart).toHaveBeenCalledOnce();
		expect(mocks.initializeStorage).not.toHaveBeenCalled();
		expect(mocks.runStartupChecks).not.toHaveBeenCalled();
	});
});
