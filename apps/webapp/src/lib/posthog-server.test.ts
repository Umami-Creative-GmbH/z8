import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	PostHogConstructor: vi.fn(),
	captureException: vi.fn(),
}));

vi.mock("posthog-node", () => ({
	PostHog: class MockPostHog {
		captureException = mockState.captureException;

		constructor(...args: unknown[]) {
			mockState.PostHogConstructor(...args);
		}
	},
}));

describe("getPostHogServer", () => {
	beforeEach(() => {
		vi.resetModules();
		mockState.PostHogConstructor.mockReset();
		mockState.captureException.mockReset();
		vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns null when the PostHog project token is not configured", async () => {
		vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", undefined);

		const { getPostHogServer } = await import("./posthog-server");

		expect(getPostHogServer()).toBeNull();
		expect(mockState.PostHogConstructor).not.toHaveBeenCalled();
	});

	it("returns null in development mode even when the PostHog project token is configured", async () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");

		const { getPostHogServer } = await import("./posthog-server");

		expect(getPostHogServer()).toBeNull();
		expect(mockState.PostHogConstructor).not.toHaveBeenCalled();
	});

	it("creates a singleton PostHog client when the project token is configured", async () => {
		vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");

		const { getPostHogServer } = await import("./posthog-server");
		const posthog = getPostHogServer();

		expect(posthog).not.toBeNull();
		expect(getPostHogServer()).toBe(posthog);
		expect(mockState.PostHogConstructor).toHaveBeenCalledTimes(1);
		expect(mockState.PostHogConstructor).toHaveBeenCalledWith("phc_test", {
			host: "https://eu.i.posthog.com",
			flushAt: 1,
			flushInterval: 0,
		});
	});
});

describe("getPostHogDistinctIdFromCookie", () => {
	it("extracts the PostHog distinct id from an encoded cookie", async () => {
		const encodedValue = encodeURIComponent(JSON.stringify({ distinct_id: "user_123" }));
		const { getPostHogDistinctIdFromCookie } = await import("./posthog-server");

		expect(getPostHogDistinctIdFromCookie(`other=value; ph_phc_test_posthog=${encodedValue}`)).toBe(
			"user_123",
		);
	});

	it("returns null for malformed or missing PostHog cookies", async () => {
		const { getPostHogDistinctIdFromCookie } = await import("./posthog-server");

		expect(getPostHogDistinctIdFromCookie("other=value")).toBeNull();
		expect(getPostHogDistinctIdFromCookie("ph_phc_test_posthog=%7Bbroken")).toBeNull();
	});
});
