/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { initMock, optOutMock, resetMock } = vi.hoisted(() => ({
	initMock: vi.fn(),
	optOutMock: vi.fn(),
	resetMock: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: {
		NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
		NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
	},
}));

vi.mock("posthog-js", () => ({
	default: {
		init: initMock,
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
	});
});
