/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	redirectWithLocaleMock,
	requireBillableTimeSettingsAccessMock,
	isBillableCurrencyLockedMock,
	listBillableRateSeriesMock,
	listBillableRateTargetOptionsMock,
	updateBillableCurrencyMock,
	routerRefreshMock,
} = vi.hoisted(() => ({
	redirectWithLocaleMock: vi.fn((path: string): never => {
		throw new Error(`NEXT_REDIRECT:${path}`);
	}),
	requireBillableTimeSettingsAccessMock: vi.fn(),
	isBillableCurrencyLockedMock: vi.fn(),
	listBillableRateSeriesMock: vi.fn(),
	listBillableRateTargetOptionsMock: vi.fn(),
	updateBillableCurrencyMock: vi.fn(),
	routerRefreshMock: vi.fn(),
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: redirectWithLocaleMock,
}));

vi.mock("@/lib/billable-time/settings-access", () => ({
	requireBillableTimeSettingsAccess: requireBillableTimeSettingsAccessMock,
}));

vi.mock("@/db", () => ({ db: {} }));

vi.mock("@/lib/billable-time/currency-lock", () => ({
	isBillableCurrencyLocked: isBillableCurrencyLockedMock,
}));

vi.mock("@/lib/billable-time/billable-rates", () => ({
	listBillableRateSeries: listBillableRateSeriesMock,
	listBillableRateTargetOptions: listBillableRateTargetOptionsMock,
}));

vi.mock("./actions", () => ({
	updateBillableCurrency: updateBillableCurrencyMock,
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("@/components/billable-time/billable-currency-form", () => ({
	useBillableCurrencyLabel: () => (currency: string) => `${currency} (Euro)`,
	BillableCurrencyForm: ({
		defaultCurrency,
		onSubmit,
		children,
	}: {
		defaultCurrency: string;
		onSubmit: (next: string) => Promise<void>;
		children: (state: { pending: boolean }) => React.ReactNode;
	}) => (
		<form
			data-testid="currency-form"
			data-default={defaultCurrency}
			onSubmit={(event) => {
				event.preventDefault();
				void onSubmit("USD");
			}}
		>
			{children({ pending: false })}
		</form>
	),
}));

vi.mock("./rates/billable-rates-overview", () => ({
	AddBillableRateAction: () => <button type="button">Add rate</button>,
	BillableRatesOverview: ({ currency }: { currency: string }) => (
		<div data-testid="billable-rates-overview">Rates in {currency}</div>
	),
}));

import { BillableCurrencyCard } from "./billable-currency-card";
import { BILLABLE_TIME_SETTINGS_PAGES } from "./billable-time-settings-pages";
import { BillableTimeSettingsShell } from "./billable-time-settings-shell";
import LegacyHandOffPage from "./hand-off/page";
import BillableTimeSettingsPage from "./page";
import LegacyRatesPage from "./rates/page";

describe("Billable Time settings IA cleanup (#1956)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireBillableTimeSettingsAccessMock.mockResolvedValue({
			authContext: { user: { id: "u1" } },
			organizationId: "org-1",
			settings: { enabled: true, currency: "EUR" },
		});
		listBillableRateSeriesMock.mockResolvedValue([]);
		listBillableRateTargetOptionsMock.mockResolvedValue({
			employees: [],
			projects: [],
			customers: [],
		});
		updateBillableCurrencyMock.mockResolvedValue({ success: true, data: {} });
	});

	it("shows exactly three configuration tabs: Billable rates, Cost rates, and Accounting", async () => {
		expect(
			BILLABLE_TIME_SETTINGS_PAGES.map(({ id, href, titleDefault }) => ({
				id,
				href,
				titleDefault,
			})),
		).toEqual([
			{
				id: "rates",
				href: "/settings/billable-time",
				titleDefault: "Billable rates",
			},
			{
				id: "cost-rates",
				href: "/settings/billable-time/cost-rates",
				titleDefault: "Cost rates",
			},
			{
				id: "accounting",
				href: "/settings/billable-time/accounting",
				titleDefault: "Accounting",
			},
		]);

		const html = renderToStaticMarkup(
			await BillableTimeSettingsShell({
				activePageId: "rates",
				children: <div>Body</div>,
			}),
		);
		const navHtml = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
		expect(navHtml).toContain("Billable rates");
		expect(navHtml).toContain("Cost rates");
		expect(navHtml).toContain("Accounting");
		expect(navHtml).not.toContain("Billable currency");
		expect(navHtml).not.toContain("Hand-off");
	});

	it("redirects /settings/billable-time/hand-off to /billable-time/hand-off preserving locale", async () => {
		const page = LegacyHandOffPage();
		const content = page.props.children as {
			type: () => Promise<never>;
		};

		await expect(content.type()).rejects.toThrow("NEXT_REDIRECT:/billable-time/hand-off");
		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/billable-time/hand-off");
	});

	it("redirects /settings/billable-time/rates to /settings/billable-time preserving locale", async () => {
		const page = LegacyRatesPage();
		const content = page.props.children as {
			type: () => Promise<never>;
		};

		await expect(content.type()).rejects.toThrow("NEXT_REDIRECT:/settings/billable-time");
		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/settings/billable-time");
	});

	it("renders Billable rates directly at /settings/billable-time with the inline currency card", async () => {
		isBillableCurrencyLockedMock.mockResolvedValue(false);

		const page = BillableTimeSettingsPage();
		const content = page.props.children as {
			type: () => Promise<React.ReactElement>;
		};
		const shellElement = await content.type();
		const rendered = await shellElement.type(shellElement.props);
		const html = renderToStaticMarkup(rendered);

		expect(html).toContain("Billable currency");
		expect(html).toContain("Save currency");
		expect(html).toContain("Rates in EUR");
		expect(html).toContain("Add rate");
	});

	it("keeps BillableCurrencyCard editable while unlocked and saves changes", async () => {
		render(<BillableCurrencyCard currency="EUR" locked={false} />);

		expect(screen.getByTestId("currency-form")).toBeTruthy();
		fireEvent.submit(screen.getByTestId("currency-form"));

		await waitFor(() => {
			expect(updateBillableCurrencyMock).toHaveBeenCalledWith({
				currency: "USD",
			});
			expect(routerRefreshMock).toHaveBeenCalledTimes(1);
		});
	});

	it("renders BillableCurrencyCard as a compact read-only locked indicator once rates exist", () => {
		render(<BillableCurrencyCard currency="EUR" locked={true} />);

		expect(screen.queryByTestId("currency-form")).toBeNull();
		expect(screen.queryByRole("button", { name: "Save currency" })).toBeNull();
		expect(screen.getByText("EUR (Euro)")).toBeTruthy();
		expect(screen.getByText(/can no longer change/i)).toBeTruthy();
	});
});
