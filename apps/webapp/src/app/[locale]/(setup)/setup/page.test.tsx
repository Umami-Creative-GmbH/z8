/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
	vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
);
const isPlatformConfigured = vi.hoisted(() => vi.fn());
const setupAuthorization = vi.hoisted(() => ({
	authorize: vi.fn(),
	get: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: setupAuthorization.get }),
}));
vi.mock("@/lib/setup/bootstrap.server", () => ({
	setupBootstrap: { authorize: setupAuthorization.authorize },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/setup/config-cache", () => ({ isPlatformConfigured }));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
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
		setupAuthorization.get.mockReset();
		setupAuthorization.authorize.mockReset();
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

	it("renders the existing setup wizard when configuration is required and authorized", async () => {
		isPlatformConfigured.mockResolvedValue(false);
		setupAuthorization.get.mockReturnValue({ value: "cookie" });
		setupAuthorization.authorize.mockResolvedValue(true);
		const page = SetupPage({ params: Promise.resolve({ locale: "de" }) });
		const content = await page.props.children.type(page.props.children.props);

		render(content);
		expect(screen.getByTestId("setup-wizard").dataset.locale).toBe("de");
	});

	it("does not render the admin form without setup authorization", async () => {
		isPlatformConfigured.mockResolvedValue(false);
		setupAuthorization.authorize.mockResolvedValue(false);
		const page = SetupPage({ params: Promise.resolve({ locale: "en" }) });
		render(await page.props.children.type(page.props.children.props));
		expect(screen.queryByTestId("setup-wizard")).toBeNull();
		expect(screen.getByText(/server console/)).toBeTruthy();
	});

	it("fails closed if Redis is unavailable", async () => {
		isPlatformConfigured.mockResolvedValue(false);
		setupAuthorization.get.mockReturnValue({ value: "cookie" });
		setupAuthorization.authorize.mockRejectedValue(new Error("Unavailable"));
		const page = SetupPage({ params: Promise.resolve({ locale: "en" }) });
		render(await page.props.children.type(page.props.children.props));
		expect(screen.queryByTestId("setup-wizard")).toBeNull();
	});
});
