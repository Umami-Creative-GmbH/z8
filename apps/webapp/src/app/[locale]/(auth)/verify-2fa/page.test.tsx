/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as verify2FAPageModule from "./page";

const getSession = vi.hoisted(() => vi.fn());
const requestHeaders = vi.hoisted(
	() => new Headers({ cookie: "two_factor=temporary" }),
);
const headers = vi.hoisted(() => vi.fn(async () => requestHeaders));

vi.mock("next/headers", () => ({
	headers,
}));

vi.mock("next/navigation", () => ({
	redirect: vi.fn(),
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
		const content = Reflect.get(verify2FAPageModule, "Verify2FAPageContent");
		expect(content).toEqual(expect.any(Function));
		if (typeof content !== "function") return;

		render(await content());

		const form = screen.getByTestId("two-factor-form");

		expect(redirect).not.toHaveBeenCalled();
		expect(headers).toHaveBeenCalledOnce();
		expect(getSession).toHaveBeenCalledWith({ headers: requestHeaders });
		expect(form.parentElement?.className).not.toContain("min-h-screen");
		expect(form.parentElement?.className).not.toContain("justify-center");
	});

	it("redirects a fully authenticated session home", async () => {
		getSession.mockResolvedValueOnce({
			user: { twoFactorEnabled: true },
		});

		const content = Reflect.get(verify2FAPageModule, "Verify2FAPageContent");
		expect(content).toEqual(expect.any(Function));
		if (typeof content !== "function") return;

		await content();

		expect(redirect).toHaveBeenCalledWith("/");
		expect(getSession).toHaveBeenCalledWith({ headers: requestHeaders });
	});
});
