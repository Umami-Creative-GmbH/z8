/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Verify2FAPage from "./page";

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
			getSession: vi.fn(async () => ({
				user: { twoFactorEnabled: true },
			})),
		},
	},
}));

describe("Verify2FAPage", () => {
	it("uses the shared auth layout without adding a nested viewport wrapper", async () => {
		render(await Verify2FAPage());

		const form = screen.getByTestId("two-factor-form");

		expect(form.parentElement?.className).not.toContain("min-h-screen");
		expect(form.parentElement?.className).not.toContain("justify-center");
	});
});
