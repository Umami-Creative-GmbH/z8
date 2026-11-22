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

const { default: ClosedMonthsSettingsPage } = await import("./page");

describe("ClosedMonthsSettingsPage legacy redirect (#1957)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the loading shell while redirecting", () => {
		const page = ClosedMonthsSettingsPage();
		render(page.props.fallback);
		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
	});

	it("redirects to /payroll?tab=closed-months in the active locale", async () => {
		redirectWithLocaleMock.mockImplementation(() => {
			throw new Error("NEXT_REDIRECT:/de/payroll?tab=closed-months");
		});

		const page = ClosedMonthsSettingsPage();
		const redirectChild = page.props.children;
		await expect(redirectChild.type(redirectChild.props)).rejects.toThrow(
			"NEXT_REDIRECT:/de/payroll?tab=closed-months",
		);
		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/payroll?tab=closed-months");
	});
});
