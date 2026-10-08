/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useEffect, useReducer } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_FINANCE_QUEUE_VIEW,
	type FinanceQueueView,
} from "@/lib/travel-expenses/finance-queue-params";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";

const mocks = vi.hoisted(() => ({
	getQueue: vi.fn(),
	getFilters: vi.fn(),
	markReimbursed: vi.fn(),
	searchListeners: new Set<() => void>(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
// Next.js re-renders `useSearchParams` readers after `history.replaceState`; so does this.
vi.mock("next/navigation", () => ({
	useSearchParams: () => {
		const [, rerender] = useReducer((count: number) => count + 1, 0);
		useEffect(() => {
			mocks.searchListeners.add(rerender);
			return () => {
				mocks.searchListeners.delete(rerender);
			};
		}, []);
		return new URLSearchParams(window.location.search);
	},
}));
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
	getTravelExpenseFinanceQueueFilterOptions: mocks.getFilters,
	markTravelExpensesReimbursedAction: mocks.markReimbursed,
}));
// A plain date input stands in for the calendar popover.
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		...props
	}: {
		value: string;
		onChange: (value: string) => void;
	} & Record<string, unknown>) => (
		<input {...props} value={value} onChange={(event) => onChange(event.target.value)} />
	),
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
		approvalBasis: null,
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
	adjustments: [],
	adjustmentOf: null,
	adjustmentDelta: null,
};
const claim: SettlementAccount = {
	...report,
	source: { type: "legacy_claim", id: "claim-1" },
	basis: {
		approvedAt: "2026-08-05T00:00:00Z",
		evidence: "legacy_claim",
		revisionId: null,
		submissionCycle: null,
		approvalBasis: null,
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

const robin = "e7530000-0000-4000-8000-000000000001";

function page(
	accounts: SettlementAccount[],
	extra: { page?: number; hasMore?: boolean; canSettle?: boolean } = {},
) {
	return {
		success: true,
		data: {
			accounts,
			canSettle: extra.canSettle ?? true,
			page: extra.page ?? 1,
			hasMore: extra.hasMore ?? false,
		},
	};
}

/** Another open report, owed in its own currency. */
function openReport(id: string, employeeName: string, currency: string, balance: string) {
	const line = {
		currency,
		entitlement: balance,
		reimbursed: "0.00",
		recovered: "0.00",
		balance,
		state: "outstanding" as const,
	};
	return {
		...report,
		source: { type: "report" as const, id },
		employeeName,
		currency,
		summary: { state: "outstanding" as const, currencies: [line] },
	};
}

function view(patch: Partial<FinanceQueueView> = {}): FinanceQueueView {
	return { ...DEFAULT_FINANCE_QUEUE_VIEW, ...patch };
}

function mount(props: { coverage?: "uncovered" } = {}) {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<FinanceQueue {...props} />
		</QueryClientProvider>,
	);
}

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of mocks.searchListeners) listener();
	};
});

describe("finance queue (#612, #753)", () => {
	beforeEach(() => {
		mocks.getQueue.mockReset();
		mocks.getFilters.mockReset();
		mocks.getFilters.mockResolvedValue({
			success: true,
			data: {
				employees: [{ id: robin, name: "Robin" }],
				teams: [{ id: "e7531000-0000-4000-8000-000000000001", name: "Berlin" }],
				currencies: ["CHF", "EUR"],
			},
		});
		window.history.replaceState(null, "", "/travel-expenses/finance");
	});
	afterEach(cleanup);

	it("lists open approved expenses with employee-paid entitlement, company-paid costs and balance", async () => {
		mocks.getQueue.mockResolvedValue(page([report]));
		mount();
		const link = await screen.findByRole("link", { name: /Robin · Customer workshop/ });
		expect(link.getAttribute("href")).toBe("/travel-expenses/reports/report-1");
		expect(screen.getByText("Company-paid €240.00")).toBeTruthy();
		expect(screen.getByText("Employee-paid €89.90")).toBeTruthy();
		expect(screen.getByText("€89.90 outstanding")).toBeTruthy();
		expect(mocks.getQueue).toHaveBeenCalledWith(view());
		// A single page shows no pagination and no truncation notice.
		expect(screen.queryByRole("navigation", { name: "Finance queue pages" })).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("switches to reimbursed expenses, including legacy claims, and keeps the choice in the URL", async () => {
		mocks.getQueue.mockImplementation(async (requested: FinanceQueueView) =>
			page(requested.status === "reimbursed" ? [claim] : [report]),
		);
		mount();
		await screen.findByText("€89.90 outstanding");
		expect(screen.getByText("Awaiting reimbursement")).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Reimbursed" }));
		const link = await screen.findByRole("link", { name: /Legacy mileage claim/ });
		expect(link.getAttribute("href")).toBe("/travel-expenses/claim-1");
		expect(mocks.getQueue).toHaveBeenLastCalledWith(view({ status: "reimbursed" }));
		expect(window.location.search).toBe("?status=reimbursed");
		expect(within(link).getAllByText("Reimbursed")).toHaveLength(2);
		expect(screen.queryByText(/settled/i)).toBeNull();
	});

	it("opens the view the URL names", async () => {
		window.history.replaceState(null, "", `?status=all&employee=${robin}&currency=CHF&page=2`);
		mocks.getQueue.mockResolvedValue(page([claim], { page: 2 }));
		mount();
		await screen.findByRole("link", { name: /Legacy mileage claim/ });
		expect(mocks.getQueue).toHaveBeenCalledWith(
			view({ status: "all", employeeId: robin, currency: "CHF", page: 2 }),
		);
		expect(screen.getByRole("combobox", { name: "Employee" }).textContent).toContain("Robin");
		expect(screen.getByRole("combobox", { name: "Currency" }).textContent).toContain("CHF");
	});

	it("filters by employee and by not yet exported, back on the first page, and clears the filters", async () => {
		window.history.replaceState(null, "", "?page=3");
		mocks.getQueue.mockResolvedValue(page([report], { page: 3 }));
		const user = userEvent.setup();
		mount();
		await screen.findByText("€89.90 outstanding");
		await user.click(screen.getByRole("combobox", { name: "Employee" }));
		await user.click(await screen.findByRole("option", { name: "Robin" }));
		await waitFor(() =>
			expect(mocks.getQueue).toHaveBeenLastCalledWith(view({ employeeId: robin })),
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Not yet exported" }));
		await waitFor(() =>
			expect(mocks.getQueue).toHaveBeenLastCalledWith(
				view({ employeeId: robin, notExported: true }),
			),
		);
		expect(window.location.search).toBe(`?employee=${robin}&notExported=1`);
		fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		await waitFor(() => expect(mocks.getQueue).toHaveBeenLastCalledWith(view()));
		expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
	});

	it("pages forward and back", async () => {
		mocks.getQueue.mockImplementation(async (requested: FinanceQueueView) =>
			requested.page === 1
				? page([report], { page: 1, hasMore: true })
				: page([claim], { page: 2, hasMore: false }),
		);
		mount();
		const pages = await screen.findByRole("navigation", { name: "Finance queue pages" });
		expect(within(pages).getByText("Page 1")).toBeTruthy();
		expect(within(pages).getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(
			true,
		);
		fireEvent.click(within(pages).getByRole("button", { name: "Next" }));
		await screen.findByRole("link", { name: /Legacy mileage claim/ });
		expect(window.location.search).toBe("?page=2");
		const second = screen.getByRole("navigation", { name: "Finance queue pages" });
		expect(within(second).getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(
			true,
		);
		fireEvent.click(within(second).getByRole("button", { name: "Previous" }));
		await screen.findByText("€89.90 outstanding");
		expect(mocks.getQueue).toHaveBeenLastCalledWith(view());
	});

	it("says when no expense matches the filters", async () => {
		window.history.replaceState(null, "", "?currency=CHF");
		mocks.getQueue.mockResolvedValue(page([]));
		mount();
		expect(await screen.findByText("No approved expenses match these filters.")).toBeTruthy();
	});

	it("lists only what no expense officer covers, with filters, pages and a way back (#756)", async () => {
		window.history.replaceState(null, "", "?coverage=uncovered");
		mocks.getQueue.mockResolvedValue(page([report], { hasMore: true }));
		mount({ coverage: "uncovered" });
		await screen.findByText("€89.90 outstanding");
		expect(mocks.getQueue).toHaveBeenCalledWith(view(), "uncovered");
		expect(screen.queryByRole("radio")).toBeNull();
		expect(
			screen.getByText("Approved expenses awaiting reimbursement that no expense officer covers."),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Show all approved expenses" }).getAttribute("href"),
		).toBe("/travel-expenses/finance");
		// Paging keeps the coverage filter in the URL.
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		await waitFor(() =>
			expect(mocks.getQueue).toHaveBeenLastCalledWith(view({ page: 2 }), "uncovered"),
		);
		expect(window.location.search).toBe("?page=2&coverage=uncovered");
	});

	it("says when every expense awaiting reimbursement is covered", async () => {
		mocks.getQueue.mockResolvedValue(page([]));
		mount({ coverage: "uncovered" });
		expect(
			await screen.findByText(
				"An expense officer covers every approved expense awaiting reimbursement.",
			),
		).toBeTruthy();
	});

	it("says when nothing is left to record and offers retry when the queue fails to load", async () => {
		mocks.getQueue
			.mockResolvedValueOnce({ success: false, error: "Failed to load the finance queue" })
			.mockResolvedValueOnce(page([]));
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(
				screen.getByText("Nothing left to record: every approved expense is reimbursed."),
			).toBeTruthy(),
		);
	});
});

describe("bulk mark as reimbursed (#754)", () => {
	const swiss = openReport("report-2", "Sam", "CHF", "120.50");
	const kim = openReport("report-3", "Kim", "EUR", "15.00");

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-08T12:00:00Z") });
		mocks.getQueue.mockReset();
		mocks.markReimbursed.mockReset();
		mocks.getFilters.mockResolvedValue({
			success: true,
			data: { employees: [], teams: [], currencies: [] },
		});
		window.history.replaceState(null, "", "/travel-expenses/finance");
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("selects open expenses, marks them reimbursed with one payment and lists every row's outcome", async () => {
		mocks.getQueue.mockResolvedValue(page([report, swiss, kim, claim]));
		mocks.markReimbursed.mockResolvedValue({
			success: true,
			data: {
				status: "processed",
				rows: [
					{
						source: report.source,
						outcome: "reimbursed",
						replayed: false,
						amount: "89.90",
						currency: "EUR",
					},
					{
						source: swiss.source,
						outcome: "reimbursed",
						replayed: false,
						amount: "120.50",
						currency: "CHF",
					},
					{
						source: kim.source,
						outcome: "balance_changed",
						replayed: false,
						amount: null,
						currency: null,
					},
				],
			},
		});
		const user = userEvent.setup();
		mount();
		await screen.findByText("€89.90 outstanding");
		// A reimbursed expense cannot be selected.
		expect(
			screen.queryByRole("checkbox", { name: /Select Robin · Legacy mileage claim/ }),
		).toBeNull();
		const action = screen.getByRole("button", { name: "Mark as reimbursed" });
		expect(action.hasAttribute("disabled")).toBe(true);

		await user.click(
			screen.getByRole("checkbox", { name: "Select all open expenses on this page" }),
		);
		expect(screen.getByText("3 selected")).toBeTruthy();
		await user.click(action);

		const dialog = await screen.findByRole("dialog", { name: "Mark as reimbursed" });
		// The payment date defaults to today.
		expect(within(dialog).getByLabelText<HTMLInputElement>(/^Payment date/).value).toBe(
			"2026-10-08",
		);
		await user.type(within(dialog).getByLabelText(/^Payment reference/), "SEPA-9");
		await user.click(within(dialog).getByRole("button", { name: "Mark 3 as reimbursed" }));

		const results = await screen.findByRole("dialog", { name: "Reimbursement results" });
		expect(mocks.markReimbursed).toHaveBeenCalledWith({
			requestKey: expect.any(String),
			accounts: [
				{ source: report.source, expectedBalance: { currency: "EUR", amount: "89.90" } },
				{ source: swiss.source, expectedBalance: { currency: "CHF", amount: "120.50" } },
				{ source: kim.source, expectedBalance: { currency: "EUR", amount: "15.00" } },
			],
			occurredOn: "2026-10-08",
			reference: "SEPA-9",
			note: null,
		});
		expect(within(results).getByText("2 of 3 reimbursed")).toBeTruthy();
		const rows = within(results).getAllByRole("listitem");
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringMatching(/Robin · Customer workshop.*Reimbursed €89.90/),
			expect.stringMatching(/Sam · Customer workshop.*Reimbursed CHF\s?120.50/),
			expect.stringMatching(/Kim · Customer workshop.*Skipped: balance changed/),
		]);

		await user.click(within(results).getByRole("button", { name: "Done" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		// The queue is read again and nothing stays selected.
		await waitFor(() => expect(mocks.getQueue.mock.calls.length).toBeGreaterThan(1));
		expect(
			screen.getByRole("button", { name: "Mark as reimbursed" }).hasAttribute("disabled"),
		).toBe(true);
	});

	it("labels every skip reason", async () => {
		const rows = (
			["own_expense", "overpaid_or_review", "already_reimbursed", "out_of_scope", "failed"] as const
		).map((outcome, index) => ({
			account: openReport(`report-${index + 10}`, `Person ${index}`, "EUR", "10.00"),
			outcome,
		}));
		mocks.getQueue.mockResolvedValue(page(rows.map((entry) => entry.account)));
		mocks.markReimbursed.mockResolvedValue({
			success: true,
			data: {
				status: "processed",
				rows: rows.map(({ account, outcome }) => ({
					source: account.source,
					outcome,
					replayed: false,
					amount: null,
					currency: null,
				})),
			},
		});
		const user = userEvent.setup();
		mount();
		await user.click(
			await screen.findByRole("checkbox", { name: "Select all open expenses on this page" }),
		);
		await user.click(screen.getByRole("button", { name: "Mark as reimbursed" }));
		const dialog = await screen.findByRole("dialog", { name: "Mark as reimbursed" });
		await user.type(within(dialog).getByLabelText(/^Payment reference/), "SEPA-9");
		await user.click(within(dialog).getByRole("button", { name: "Mark 5 as reimbursed" }));
		const results = await screen.findByRole("dialog", { name: "Reimbursement results" });
		expect(within(results).getByText("0 of 5 reimbursed")).toBeTruthy();
		expect(
			within(results)
				.getAllByRole("listitem")
				.map((row) => row.textContent),
		).toEqual([
			expect.stringContaining("Skipped: your own expense"),
			expect.stringContaining("Skipped: overpaid or needs review"),
			expect.stringContaining("Skipped: already reimbursed"),
			expect.stringContaining("Skipped: out of scope"),
			expect.stringContaining("Failed"),
		]);
	});

	it("requires a payment reference and refuses a future payment date", async () => {
		mocks.getQueue.mockResolvedValue(page([report]));
		const user = userEvent.setup();
		mount();
		await user.click(
			await screen.findByRole("checkbox", { name: "Select Robin · Customer workshop" }),
		);
		await user.click(screen.getByRole("button", { name: "Mark as reimbursed" }));
		const dialog = await screen.findByRole("dialog", { name: "Mark as reimbursed" });
		const date = within(dialog).getByLabelText(/^Payment date/);
		fireEvent.change(date, { target: { value: "2026-12-24" } });
		await user.click(within(dialog).getByRole("button", { name: "Mark 1 as reimbursed" }));
		expect(
			await within(dialog).findByText(
				"Enter the payment reference, e.g. the bank transfer reference.",
			),
		).toBeTruthy();
		expect(within(dialog).getByText("A payment cannot be dated in the future.")).toBeTruthy();
		expect(mocks.markReimbursed).not.toHaveBeenCalled();
	});

	it("offers no selection to readers who cannot record reimbursements", async () => {
		mocks.getQueue.mockResolvedValue(page([report], { canSettle: false }));
		mount();
		await screen.findByText("€89.90 outstanding");
		expect(screen.queryByRole("checkbox", { name: /Select/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Mark as reimbursed" })).toBeNull();
	});
});
