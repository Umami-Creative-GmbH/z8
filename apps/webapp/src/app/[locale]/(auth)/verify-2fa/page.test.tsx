/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Verify2FAPage from "./page";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
	redirect: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/components/two-factor-verification-form", () => ({
	TwoFactorVerificationForm: () => <div data-testid="two-factor-form" />,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession,
		},
	},
}));

describe("Verify2FAPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the verification form for a pending 2FA flow without a full session", async () => {
		getSession.mockResolvedValueOnce(null);

		render(await Verify2FAPage());

		const form = screen.getByTestId("two-factor-form");

		expect(redirect).not.toHaveBeenCalled();
		expect(form.parentElement?.className).not.toContain("min-h-screen");
		expect(form.parentElement?.className).not.toContain("justify-center");
	});

	it("redirects a fully authenticated session home", async () => {
		getSession.mockResolvedValueOnce({
			user: { twoFactorEnabled: true },
		});

		await Verify2FAPage();

		expect(redirect).toHaveBeenCalledWith("/");
	});
});
