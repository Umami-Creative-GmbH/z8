/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() =>
	vi.fn(() => {
		throw new Error("not found");
	}),
);

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.licenses" ? "Lizenzen werden geladen" : fallback,
	}),
}));
vi.mock("@/components/info-header", () => ({
	InfoHeader: ({
		locale,
		titleKey,
		titleDefault,
	}: {
		locale: string;
		titleKey: string;
		titleDefault: string;
	}) => (
		<div
			data-testid="info-header"
			data-locale={locale}
			data-title-key={titleKey}
		>
			{titleDefault}
		</div>
	),
}));
vi.mock("@/components/licenses/license-table", () => ({
	LicenseTable: () => <div data-testid="license-table" />,
}));

const { default: LicensesPage } = await import("./page");

describe("LicensesPage", () => {
	it("renders a meaningful localized fallback while locale params are unresolved", async () => {
		await act(async () => {
			render(<LicensesPage params={new Promise<never>(() => {})} />);
		});

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Lizenzen werden geladen")).toBeTruthy();
	});

	it("renders InfoHeader and LicenseTable for supported locales", async () => {
		const page = LicensesPage({ params: Promise.resolve({ locale: "en" }) });
		const content = await page.props.children.type(page.props.children.props);

		render(content);

		const header = screen.getByTestId("info-header");
		expect(header.getAttribute("data-locale")).toBe("en");
		expect(header.getAttribute("data-title-key")).toBe("info.licenses");
		expect(screen.getByTestId("license-table")).toBeTruthy();
	});

	it("preserves not-found behavior for unsupported locales", async () => {
		const page = LicensesPage({ params: Promise.resolve({ locale: "xx" }) });

		await expect(
			page.props.children.type(page.props.children.props),
		).rejects.toThrow("not found");
		expect(notFound).toHaveBeenCalledOnce();
	});
});
