/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const conversion = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	getLegacyTravelExpenseConversion: conversion.load,
}));

import { LegacyConversionNotice } from "./legacy-conversion-notice";

afterEach(cleanup);

const legacy = {
	type: "mileage",
	tripStartDate: "2026-03-29",
	tripEndDate: "2026-03-31",
	tripDateTimeZone: "Europe/Berlin",
	destinationCity: "Hamburg",
	destinationCountry: "DE",
	projectId: null,
	originalAmount: "84.00",
	originalCurrency: "EUR",
	calculatedAmount: "84.00",
	calculatedCurrency: "EUR",
	notes: "Office Berlin to customer Hamburg and back",
	createdAt: "2026-03-28T10:00:00.000Z",
	attachments: [],
};

function mount() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<LegacyConversionNotice reportId="report-1" />
		</QueryClientProvider>,
	);
}

describe("LegacyConversionNotice", () => {
	it("explains why fields are empty and keeps the typed total and notes for reference only", async () => {
		conversion.load.mockResolvedValueOnce({
			success: true,
			data: {
				claimId: "claim-1",
				reportId: "report-1",
				itemId: "item-1",
				convertedAt: "2026-10-07T08:00:00.000Z",
				flags: ["expense_date_unknown", "manual_total_not_used", "notes_not_carried"],
				legacy,
			},
		});
		mount();
		expect(await screen.findByText("Continued from an earlier claim draft")).toBeTruthy();
		expect(
			screen.getByText(
				"The draft covered Mar 29, 2026 – Mar 31, 2026. Choose the day of this expense.",
			),
		).toBeTruthy();
		expect(screen.getByText(/typed total of €84\.00\. It is not used/)).toBeTruthy();
		expect(screen.getByText("Office Berlin to customer Hamburg and back")).toBeTruthy();
		expect(screen.getByRole("link", { name: /View the original draft/ }).getAttribute("href")).toBe(
			"/travel-expenses/claim-1",
		);
	});

	it("renders nothing for a report that did not come from a legacy draft", async () => {
		conversion.load.mockResolvedValueOnce({ success: true, data: null });
		mount();
		await vi.waitFor(() => expect(conversion.load).toHaveBeenCalledWith({ reportId: "report-1" }));
		expect(screen.queryByText("Continued from an earlier claim draft")).toBeNull();
	});
});
