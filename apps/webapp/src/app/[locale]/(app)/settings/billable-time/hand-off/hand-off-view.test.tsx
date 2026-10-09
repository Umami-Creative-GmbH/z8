/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import type { HandOffOverview } from "./actions";

const mocks = vi.hoisted(() => ({ getHandOffOverview: vi.fn() }));

vi.mock("./actions", () => ({
	checkInvoiceDraftStatusAction: vi.fn(),
	clearChangedAfterInvoicingAction: vi.fn(),
	confirmHandOffAction: vi.fn(),
	getHandOffOverview: mocks.getHandOffOverview,
	getInvoiceDraftAction: vi.fn(),
	previewHandOffAction: vi.fn(),
	releaseInvoiceDraftAction: vi.fn(),
	retryHandOffAction: vi.fn(),
}));

vi.mock("@/components/billable-time/hand-off/hand-off-form", () => ({
	HandOffForm: () => null,
}));

vi.mock("@/components/billable-time/hand-off/invoice-draft-panel", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/components/billable-time/hand-off/invoice-draft-panel")
	>()),
	InvoiceDraftPanel: () => null,
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

import { HandOffView } from "./hand-off-view";

const overview: HandOffOverview = {
	customers: [],
	drafts: [
		{
			id: "draft-1",
			customerId: "customer-1",
			customerName: "Acme",
			providerKind: "lexware_office",
			status: "created",
			period: { from: "2026-03-01", to: "2026-03-31" },
			currency: "EUR",
			netTotal: "950.00",
			externalId: "x-1",
			externalUrl: null,
			createdAt: "2026-04-01T08:00:00Z",
			createdByName: "Ada",
			workCount: 3,
			changedCount: 1,
			outcomeUnknown: false,
			lastFailureMessage: null,
			toolStatus: null,
			toolStatusCheckedAt: null,
		},
	],
	changedAfterInvoicing: [
		{
			invoiceDraftId: "draft-1",
			invoicedWorkId: "iw-1",
			workPeriodId: "wp-1",
			day: "2026-03-02",
			employeeName: "Grace",
			projectName: "Website",
			hours: "2.50",
			carried: false,
			changedAfterInvoicingAt: "2026-04-02T08:00:00Z",
			changedFields: ["times"],
		},
	],
};

function renderView() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<HandOffView />, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}

afterEach(() => {
	window.location.hash = "";
	vi.restoreAllMocks();
});

describe("HandOffView", () => {
	it("shows each hand-off's period as localized days and its changed count in words", async () => {
		mocks.getHandOffOverview.mockResolvedValue({ success: true, data: overview });
		renderView();

		expect(await screen.findByText("Mar 1, 2026 – Mar 31, 2026")).toBeTruthy();
		expect(screen.getByText("1 work period changed after invoicing")).toBeTruthy();
		expect(screen.getByText("Mar 2, 2026")).toBeTruthy();
	});

	it("scrolls to the marked work when a report links to it", async () => {
		mocks.getHandOffOverview.mockResolvedValue({ success: true, data: overview });
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		window.location.hash = "#changed-after-invoicing";
		renderView();

		await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
		const section = document.getElementById("changed-after-invoicing");
		expect(section?.textContent).toContain("Grace");
	});
});
