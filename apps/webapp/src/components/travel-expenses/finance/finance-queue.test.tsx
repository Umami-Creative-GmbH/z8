/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";

const mocks = vi.hoisted(() => ({ getQueue: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		className,
	}: {
		href: string;
		children: ReactNode;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseFinanceQueue: mocks.getQueue,
}));

import { FinanceQueue } from "./finance-queue";

const report: SettlementAccount = {
	source: { type: "report", id: "report-1" },
	organizationId: "org",
	employeeId: "employee",
	employeeName: "Robin",
	approved: true,
	currency: "EUR",
	basis: {
		evidence: "frozen_revision",
		revisionId: "revision",
		submissionCycle: 1,
		approvedAt: "2026-09-20T10:00:00Z",
		companyPaid: "240.00",
	},
	entitlement: [{ kind: "approved_submission", id: "revision", currency: "EUR", amount: "89.90" }],
	entries: [],
	summary: {
		state: "outstanding",
		currencies: [
			{
				currency: "EUR",
				entitlement: "89.90",
				reimbursed: "0.00",
				recovered: "0.00",
				balance: "89.90",
				state: "outstanding",
			},
		],
	},
	title: {
		kind: "trip",
		purpose: "Customer workshop",
		startDate: "2026-09-14",
		endDate: "2026-09-16",
	},
};
const claim: SettlementAccount = {
	...report,
	source: { type: "legacy_claim", id: "claim-1" },
	basis: {
		approvedAt: "2026-08-05T00:00:00Z",
		evidence: "legacy_claim",
		revisionId: null,
		submissionCycle: null,
		companyPaid: null,
	},
	title: { kind: "legacy_claim", claimType: "mileage", startDate: null, endDate: null },
	summary: {
		state: "settled",
		currencies: [
			{
				currency: "EUR",
				entitlement: "42.00",
				reimbursed: "42.00",
				recovered: "0.00",
				balance: "0.00",
				state: "settled",
			},
		],
	},
};

function mount() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<FinanceQueue />
		</QueryClientProvider>,
	);
}

describe("finance queue (#612)", () => {
	beforeEach(() => mocks.getQueue.mockReset());
	afterEach(cleanup);

	it("lists open approved expenses with employee-paid entitlement, company-paid costs and balance", async () => {
		mocks.getQueue.mockResolvedValue({
			success: true,
			data: { accounts: [report], canSettle: true },
		});
		mount();
		const link = await screen.findByRole("link", { name: /Robin · Customer workshop/ });
		expect(link.getAttribute("href")).toBe("/travel-expenses/reports/report-1");
		expect(screen.getByText("Company-paid €240.00")).toBeTruthy();
		expect(screen.getByText("Employee-paid €89.90")).toBeTruthy();
		expect(screen.getByText("€89.90 outstanding")).toBeTruthy();
		expect(mocks.getQueue).toHaveBeenCalledWith("open");
	});

	it("switches to settled expenses, including legacy claims, and links claims to their detail", async () => {
		mocks.getQueue.mockImplementation(async (filter: string) => ({
			success: true,
			data: { accounts: filter === "settled" ? [claim] : [report], canSettle: true },
		}));
		mount();
		await screen.findByText("€89.90 outstanding");
		fireEvent.click(screen.getByRole("radio", { name: "Settled" }));
		const link = await screen.findByRole("link", { name: /Legacy mileage claim/ });
		expect(link.getAttribute("href")).toBe("/travel-expenses/claim-1");
		expect(mocks.getQueue).toHaveBeenLastCalledWith("settled");
	});

	it("says when nothing is left to settle and offers retry when the queue fails to load", async () => {
		mocks.getQueue
			.mockResolvedValueOnce({ success: false, error: "Failed to load the finance queue" })
			.mockResolvedValueOnce({ success: true, data: { accounts: [], canSettle: true } });
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(
				screen.getByText("Nothing to settle: every approved expense is settled."),
			).toBeTruthy(),
		);
	});
});
