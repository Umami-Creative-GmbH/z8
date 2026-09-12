import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	initialize: vi.fn(),
	invalidate: vi.fn(),
	configured: vi.fn(),
}));
vi.mock("./bootstrap.server", () => ({
	setupBootstrap: {
		initialize: mocks.initialize,
		invalidate: mocks.invalidate,
	},
	hasPlatformAdmin: mocks.configured,
}));
vi.mock("@/env", () => ({ env: { APP_URL: "https://z8.example.com" } }));

describe("setup startup", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.stubEnv("NEXT_PHASE", "");
		vi.stubEnv("npm_lifecycle_event", "start");
		mocks.configured.mockResolvedValue(false);
	});

	it("prints the temporary code and absolute URL only to the operator console", async () => {
		mocks.initialize.mockResolvedValue({
			code: "a".repeat(64),
			remainingSeconds: 1234,
			exchanged: false,
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { initializeSetupOnStartup } = await import("./startup");
		await initializeSetupOnStartup();
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining(`Setup code: ${"a".repeat(64)}`),
		);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining(
				`https://z8.example.com/setup?code=${"a".repeat(64)}`,
			),
		);
		log.mockRestore();
	});

	it("does not touch Redis during production builds", async () => {
		vi.stubEnv("NEXT_PHASE", "phase-production-build");
		const { initializeSetupOnStartup } = await import("./startup");
		await initializeSetupOnStartup();
		expect(mocks.initialize).not.toHaveBeenCalled();
	});

	it("does not print a code if an admin won the startup race", async () => {
		mocks.initialize.mockResolvedValue({
			code: "a".repeat(64),
			remainingSeconds: 3600,
			exchanged: false,
		});
		mocks.configured.mockResolvedValue(true);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { initializeSetupOnStartup } = await import("./startup");
		await initializeSetupOnStartup();
		expect(mocks.invalidate).toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
