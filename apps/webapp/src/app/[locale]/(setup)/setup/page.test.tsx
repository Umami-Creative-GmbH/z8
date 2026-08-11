/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
	vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
);
const isPlatformConfigured = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/setup/config-cache", () => ({ isPlatformConfigured }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.setup" ? "Einrichtung wird geladen" : fallback,
	}),
}));
vi.mock("@/components/setup/setup-wizard-form", () => ({
	SetupWizardForm: ({ locale }: { locale: string }) => (
		<div data-testid="setup-wizard" data-locale={locale} />
	),
}));

const { default: SetupPage } = await import("./page");

describe("SetupPage", () => {
	beforeEach(() => {
		redirect.mockClear();
		isPlatformConfigured.mockReset();
	});

	it("renders a meaningful localized fallback while request data is unresolved", async () => {
		isPlatformConfigured.mockReturnValue(new Promise<never>(() => {}));

		await act(async () => {
			render(<SetupPage params={new Promise<never>(() => {})} />);
		});

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Einrichtung wird geladen")).toBeTruthy();
	});

	it("preserves the configured-instance redirect", async () => {
		isPlatformConfigured.mockResolvedValue(true);
		const page = SetupPage({ params: Promise.resolve({ locale: "de" }) });

		await expect(
			page.props.children.type(page.props.children.props),
		).rejects.toThrow("redirect:/de/");
		expect(redirect).toHaveBeenCalledWith("/de/");
	});

	it("renders the existing setup wizard when configuration is required", async () => {
		isPlatformConfigured.mockResolvedValue(false);
		const page = SetupPage({ params: Promise.resolve({ locale: "de" }) });
		const content = await page.props.children.type(page.props.children.props);

		render(content);
		expect(screen.getByTestId("setup-wizard").dataset.locale).toBe("de");
	});
});
