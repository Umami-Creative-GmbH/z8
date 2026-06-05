/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initMock, optInMock, optOutMock, resetMock } = vi.hoisted(() => ({
	initMock: vi.fn(),
	optInMock: vi.fn(),
	optOutMock: vi.fn(),
	resetMock: vi.fn(),
}));

const mockEnv = vi.hoisted(() => ({
	NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
	NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
}));

vi.mock("@/env", () => ({
	env: mockEnv,
}));

vi.mock("posthog-js", () => ({
	default: {
		init: initMock,
		opt_in_capturing: optInMock,
		opt_out_capturing: optOutMock,
		reset: resetMock,
	},
}));

vi.mock("posthog-js/react", () => ({
	PostHogProvider: ({ children }: { children: ReactNode }) => (
		<div data-testid="posthog-provider">{children}</div>
	),
}));

import { PostHogProvider } from "./posthog-provider";

describe("PostHogProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
		mockEnv.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not initialize tracking when product improvement consent is disabled", () => {
		render(
			<PostHogProvider helpImproveProduct={false}>
				<div>App</div>
			</PostHogProvider>,
		);

		expect(screen.getByText("App")).toBeTruthy();
		expect(screen.queryByTestId("posthog-provider")).toBeNull();
		expect(initMock).not.toHaveBeenCalled();
		expect(optInMock).not.toHaveBeenCalled();
		expect(optOutMock).toHaveBeenCalled();
		expect(resetMock).toHaveBeenCalled();
	});

	it("initializes tracking when product improvement consent is enabled", () => {
		render(
			<PostHogProvider helpImproveProduct>
				<div>App</div>
			</PostHogProvider>,
		);

		expect(screen.getByTestId("posthog-provider")).toBeTruthy();
		expect(initMock).toHaveBeenCalledWith(
			"phc_test",
			expect.objectContaining({ api_host: "/ingest" }),
		);
		expect(optInMock).toHaveBeenCalled();
		expect(initMock.mock.invocationCallOrder[0]).toBeLessThan(
			optInMock.mock.invocationCallOrder[0],
		);
	});

	it("does not initialize tracking in development mode", () => {
		vi.stubEnv("NODE_ENV", "development");

		render(
			<PostHogProvider helpImproveProduct>
				<div>App</div>
			</PostHogProvider>,
		);

		expect(screen.getByText("App")).toBeTruthy();
		expect(screen.queryByTestId("posthog-provider")).toBeNull();
		expect(initMock).not.toHaveBeenCalled();
		expect(optInMock).not.toHaveBeenCalled();
		expect(optOutMock).not.toHaveBeenCalled();
		expect(resetMock).not.toHaveBeenCalled();
	});
});
