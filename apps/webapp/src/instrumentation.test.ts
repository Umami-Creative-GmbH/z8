import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	initializeStorage: vi.fn(async () => ({ success: true })),
	runStartupChecks: vi.fn(async () => true),
	sdkStart: vi.fn(),
	initializeSetupOnStartup: vi.fn(async () => undefined),
	otlpExporter: vi.fn(),
	batchSpanProcessor: vi.fn(),
}));

vi.mock("@opentelemetry/api", () => ({
	SpanStatusCode: { ERROR: 2 },
}));
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
	getNodeAutoInstrumentations: vi.fn(() => []),
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
	OTLPTraceExporter: class {
		constructor(options: unknown) {
			mocks.otlpExporter(options);
		}
	},
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
	BatchSpanProcessor: class {
		constructor(exporter: unknown) {
			mocks.batchSpanProcessor(exporter);
		}
	},
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
vi.mock("@/lib/setup/startup", () => ({
	initializeSetupOnStartup: mocks.initializeSetupOnStartup,
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
		expect(mocks.initializeSetupOnStartup).not.toHaveBeenCalled();
	});

	it("initializes setup after runtime health checks", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("NEXT_PHASE", "");
		vi.stubEnv("npm_lifecycle_event", "start");
		vi.stubEnv("NODE_ENV", "test");
		const on = vi.spyOn(process, "on").mockReturnValue(process);
		await register();
		expect(mocks.initializeSetupOnStartup).toHaveBeenCalledOnce();
		expect(
			mocks.initializeSetupOnStartup.mock.invocationCallOrder[0],
		).toBeGreaterThan(mocks.runStartupChecks.mock.invocationCallOrder[0]);
		on.mockRestore();
	});

	it("exports traces over OTLP in production when an endpoint is configured", async () => {
		vi.stubEnv("NEXT_RUNTIME", "nodejs");
		vi.stubEnv("NEXT_PHASE", "phase-production-build");
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv(
			"OTEL_EXPORTER_OTLP_ENDPOINT",
			"http://collector:4318/v1/traces",
		);

		await register();

		expect(mocks.otlpExporter).toHaveBeenCalledWith({
			url: "http://collector:4318/v1/traces",
		});
		expect(mocks.batchSpanProcessor).toHaveBeenCalledOnce();
		expect(mocks.sdkStart).toHaveBeenCalledOnce();
	});

	it("does not start the Node SDK in the Edge runtime", async () => {
		vi.stubEnv("NEXT_RUNTIME", "edge");

		await register();

		expect(mocks.sdkStart).not.toHaveBeenCalled();
	});

	it("keeps Node-only OpenTelemetry modules out of the Edge-compiled entry", () => {
		// Turbopack compiles instrumentation.ts for Edge too; a static import here
		// pulls the Node SDK and its auto-instrumentations into that bundle.
		const source = readFileSync(
			fileURLToPath(new URL("./instrumentation.ts", import.meta.url)),
			"utf8",
		);

		expect(source).not.toMatch(/^import(?!\s+type)[^;]*["']@opentelemetry\//m);
	});
});
