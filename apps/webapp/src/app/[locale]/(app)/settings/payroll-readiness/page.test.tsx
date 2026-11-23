/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectWithLocaleMock = vi.hoisted(() => vi.fn());

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: redirectWithLocaleMock,
}));

const { default: PayrollReadinessPage } = await import("./page");

describe("PayrollReadinessPage legacy redirect (#1957)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the loading shell while redirecting", () => {
		const page = PayrollReadinessPage();
		render(page.props.fallback);
		expect(screen.getByLabelText("Loading payroll readiness")).toBeTruthy();
	});

	it("redirects to /payroll in the active locale", async () => {
		redirectWithLocaleMock.mockImplementation(() => {
			throw new Error("NEXT_REDIRECT:/de/payroll");
		});

		const page = PayrollReadinessPage();
		const redirectChild = page.props.children;
		await expect(redirectChild.type(redirectChild.props)).rejects.toThrow(
			"NEXT_REDIRECT:/de/payroll",
		);
		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/payroll");
	});
});
