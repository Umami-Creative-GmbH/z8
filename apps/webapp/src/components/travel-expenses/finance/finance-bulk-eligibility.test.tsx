/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";
import { BulkReimbursementDialog } from "./bulk-reimbursement-dialog";

const edge = vi.hoisted(() => ({
	included: false,
	canSettle: true,
	reads: vi.fn(),
	writes: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, p?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (s, k) => String(p?.[k] ?? s)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
	Link: ({ children, ...p }: { children: ReactNode; href: string }) => <a {...p}>{children}</a>,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: false,
		data: {
			user: { id: "eligibility-reader" },
			session: { activeOrganizationId: "eligibility-org" },
		},
	}),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		name,
		value,
		onChange,
	}: {
		name: string;
		value: string;
		onChange: (s: string) => void;
	}) => (
		<input
			aria-label="Payment date"
			name={name}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		/>
	),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseFinanceQueue: edge.reads,
	getTravelExpenseFinanceQueueFilterOptions: async () => ({
		success: true,
		data: { employees: [], teams: [], currencies: ["EUR"] },
	}),
	markTravelExpensesReimbursedAction: edge.writes,
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { FinanceQueue } from "@/components/travel-expenses/finance/finance-queue";

const id = "45d0ed03-b4ac-4b1d-b9ef-8121f3aa1571";
const title = "INDEPENDENT_PAYROLL_ELIGIBILITY";
const run = {
	jobId: "run-independent",
	formatName: "Payroll Eligibility Control",
	periodStart: "2026-10-01",
	periodEnd: "2026-10-31",
};
const line: SettlementAccount["summary"]["currencies"][number] = {
	currency: "EUR",
	entitlement: "48.00",
	reimbursed: "0.00",
	recovered: "0.00",
	balance: "48.00",
	state: "outstanding",
};
function account(): SettlementAccount {
	return {
		source: { type: "report", id },
		organizationId: "eligibility-org",
		employeeId: "beneficiary",
		employeeName: "Synthetic Beneficiary",
		approved: true,
		currency: "EUR",
		basis: {
			evidence: "frozen_revision",
			revisionId: "revision-independent",
			submissionCycle: 1,
			approvedAt: "2026-10-02T09:00:00Z",
			companyPaid: "0.00",
			approvalBasis: null,
		},
		entitlement: [
			{ kind: "approved_submission", id: "revision-independent", currency: "EUR", amount: "48.00" },
		],
		entries: [],
		summary: { state: "outstanding", currencies: [{ ...line }] },
		title: { kind: "trip", purpose: title, startDate: null, endDate: null },
		adjustments: [],
		adjustmentOf: null,
		adjustmentDelta: null,
		payrollRun: edge.included ? run : null,
		confirmedPayrollRuns: [],
	};
}
const clients: QueryClient[] = [];
const bootstrapAt = Date.now();
const retiredMessage =
	"One or more selected expenses changed. Close this dialog and review the current expenses before starting another payment.";
const failureMessage = "The expenses could not be marked as reimbursed. Please retry.";
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
	});
	clients.push(client);
	const initialContext = {
		userId: "eligibility-reader",
		organizationId: "eligibility-org",
		employee: {
			employeeId: "reader-employee",
			organizationId: "eligibility-org",
			role: "employee" as const,
		},
		organizationSettings: null,
		updatedAt: bootstrapAt,
	};
	const Queue = FinanceQueue;
	const view = (hidden = false) => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={initialContext}>
				<Activity mode={hidden ? "hidden" : "visible"}>
					<Queue />
				</Activity>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const mounted = render(view());
	return { client, setHidden: (hidden: boolean) => mounted.rerender(view(hidden)) };
}
beforeEach(() => {
	edge.included = false;
	edge.canSettle = true;
	edge.reads.mockReset().mockImplementation(async () => ({
		success: true,
		data: { accounts: [account()], page: 1, hasMore: false, canSettle: edge.canSettle },
	}));
	edge.writes.mockReset().mockResolvedValue({ success: false, error: "Unauthorized" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw Error("Unexpected context fetch: fresh bootstrap remains valid");
		}),
	);
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.unstubAllGlobals();
});
async function open() {
	await screen.findByRole("link", { name: new RegExp(title) });
	fireEvent.click(
		screen.getByRole("checkbox", {
			name: "Select all expenses awaiting reimbursement on this page",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Mark as reimbursed", exact: true }));
	const dialog = await screen.findByRole("dialog");
	fireEvent.change(within(dialog).getByLabelText(/Payment reference/), {
		target: { value: "INDEPENDENT-BANK-48" },
	});
	return dialog;
}
async function refresh({ client }: { client: QueryClient }) {
	const count = edge.reads.mock.calls.length;
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["travel-expenses", "finance"] });
	});
	await waitFor(() => expect(edge.reads).toHaveBeenCalledTimes(count + 1));
}
async function submit() {
	const dialog = screen.getByRole("dialog");
	const button = within(dialog).getByRole("button", { name: "Mark 1 as reimbursed", exact: true });
	const wasDisabled = button.hasAttribute("disabled");
	fireEvent.click(button);
	if (wasDisabled) {
		await screen.findByText(
			"One or more selected expenses changed. Close this dialog and review the current expenses before starting another payment.",
		);
		expect(edge.writes).not.toHaveBeenCalled();
	} else await screen.findByText("The expenses could not be marked as reimbursed. Please retry.");
}
it("positive current unchanged authorized refresh preserves draft and sends one explicit payment", async () => {
	const c = mount();
	await open();
	await refresh(c);
	expect(screen.getByLabelText(/Payment reference/)).toHaveProperty("value", "INDEPENDENT-BANK-48");
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(1);
});
it("positive current initially included payroll report offers no bulk payment target", async () => {
	edge.included = true;
	mount();
	await screen.findByRole("link", { name: new RegExp(title) });
	expect(screen.queryByRole("checkbox", { name: /Select Synthetic/ })).toBeNull();
	expect(screen.getByRole("button", { name: "Mark as reimbursed", exact: true })).toHaveProperty(
		"disabled",
		true,
	);
	expect(edge.writes).not.toHaveBeenCalled();
});
it("positive current explicit settle capability loss removes the open dialog", async () => {
	const c = mount();
	await open();
	edge.canSettle = false;
	await refresh(c);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(edge.writes).not.toHaveBeenCalled();
});
async function newlyIncluded() {
	const c = mount();
	await open();
	edge.included = true;
	await refresh(c);
	const inclusion = await screen.findByText(/Included in Payroll run/);
	const link = inclusion.closest("a");
	expect(link?.textContent).toContain(title);
	expect(link?.textContent).toContain("Payroll Eligibility Control");
	expect(edge.writes).not.toHaveBeenCalled();
	await submit();
}
it("PRIORITY current newly observed payroll inclusion retires the captured bulk payment target", async () => {
	await newlyIncluded();
	expect(
		edge.writes,
		"A fresh canonical included-payroll read must retire the old bank-payment target",
	).not.toHaveBeenCalled();
});

function reply(accounts: SettlementAccount[], canSettle = true) {
	return { success: true as const, data: { accounts, page: 1, hasMore: false, canSettle } };
}
function blocked() {
	const dialog = screen.getByRole("dialog");
	expect(within(dialog).getByText(retiredMessage)).toBeTruthy();
	expect(within(dialog).getByRole("button", { name: /Mark \d+ as reimbursed/ })).toHaveProperty(
		"disabled",
		true,
	);
	expect(within(dialog).getByLabelText(/Payment reference/)).toHaveProperty(
		"value",
		"INDEPENDENT-BANK-48",
	);
	return dialog;
}
async function nativeSubmit(dialog: HTMLElement) {
	const form = within(dialog)
		.getByLabelText(/Payment reference/)
		.closest("form");
	expect(form).not.toBeNull();
	await act(async () => {
		if (form) fireEvent.submit(form);
	});
}

it.each(["balance", "currency", "approval", "settled", "mixed-currency"] as const)(
	"fresh explicit %s change retires the captured request without retargeting it",
	async (change) => {
		const c = mount();
		const dialog = await open();
		fireEvent.change(within(dialog).getByLabelText(/Note/), {
			target: { value: "Retain this exact explanation" },
		});
		const date = within(dialog).getByLabelText("Payment date").getAttribute("value");
		const next = account();
		if (change === "balance") next.summary.currencies[0].balance = "37.00";
		if (change === "currency") next.currency = "CHF";
		if (change === "approval") next.approved = false;
		if (change === "settled") {
			next.summary.state = "settled";
			next.summary.currencies[0].state = "settled";
			next.summary.currencies[0].balance = "0.00";
		}
		if (change === "mixed-currency")
			next.summary.currencies.push({
				...next.summary.currencies[0],
				currency: "USD",
				balance: "5.00",
			});
		edge.reads.mockResolvedValueOnce(reply([next]));
		await refresh(c);
		const retained = blocked();
		expect(within(retained).getByLabelText(/Note/)).toHaveProperty(
			"value",
			"Retain this exact explanation",
		);
		expect(within(retained).getByLabelText("Payment date")).toHaveProperty("value", date);
		await nativeSubmit(retained);
		expect(edge.writes).not.toHaveBeenCalled();
	},
);

it("payroll retirement survives an outage and later eligibility restoration until close and reselection", async () => {
	const c = mount();
	await open();
	edge.included = true;
	await refresh(c);
	blocked();
	edge.reads.mockRejectedValueOnce(Error("Temporary transport outage"));
	await refresh(c);
	blocked();
	edge.included = false;
	await refresh(c);
	const dialog = blocked();
	await nativeSubmit(dialog);
	expect(edge.writes).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await open();
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(1);
	expect(edge.writes.mock.calls[0][0].accounts).toEqual([
		{ source: { type: "report", id }, expectedBalance: { currency: "EUR", amount: "48.00" } },
	]);
});

it("an omitted filtered-page source does not retire or replace the captured source", async () => {
	const c = mount();
	await open();
	const other = account();
	other.source = { type: "report", id: "cf47e7eb-20c9-4b6e-a7b3-1d07251393e0" };
	other.title = {
		kind: "trip",
		purpose: "Different filtered result",
		startDate: null,
		endDate: null,
	};
	edge.reads.mockResolvedValueOnce(reply([other]));
	await refresh(c);
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(1);
	expect(edge.writes.mock.calls[0][0].accounts).toEqual([
		{ source: { type: "report", id }, expectedBalance: { currency: "EUR", amount: "48.00" } },
	]);
});

it("one explicitly disqualified source blocks the whole captured batch", async () => {
	const first = account(),
		second = account();
	second.source = { type: "report", id: "cf47e7eb-20c9-4b6e-a7b3-1d07251393e0" };
	second.employeeName = "Second Synthetic Beneficiary";
	second.title = {
		kind: "trip",
		purpose: "Second captured report",
		startDate: null,
		endDate: null,
	};
	edge.reads.mockResolvedValueOnce(reply([first, second]));
	const c = mount();
	const dialog = await open();
	expect(within(dialog).getByRole("button", { name: "Mark 2 as reimbursed" })).toBeTruthy();
	second.payrollRun = run;
	edge.reads.mockResolvedValueOnce(reply([first, second]));
	await refresh(c);
	await nativeSubmit(blocked());
	expect(edge.writes).not.toHaveBeenCalled();
});

it("unchanged refreshed objects and a transport retry retain the exact request key and payment", async () => {
	const c = mount();
	const dialog = await open();
	fireEvent.change(within(dialog).getByLabelText(/Note/), {
		target: { value: "Batch explanation" },
	});
	await submit();
	const request = edge.writes.mock.calls[0][0];
	await refresh(c);
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(2);
	expect(edge.writes.mock.calls[1][0]).toEqual(request);
});

it("settle-capability restoration cannot reopen the retired captured dialog", async () => {
	const c = mount();
	await open();
	edge.canSettle = false;
	await refresh(c);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	edge.canSettle = true;
	await refresh(c);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});

it("retirement during a dispatched request preserves the unresolved-command lock and suppresses late feedback", async () => {
	let finish: (value: { success: false; error: string }) => void = () => {
		throw Error("Request did not start");
	};
	const held = new Promise<{ success: false; error: string }>((resolve) => {
		finish = resolve;
	});
	edge.writes.mockReturnValueOnce(held);
	const c = mount();
	const dialog = await open();
	fireEvent.click(within(dialog).getByRole("button", { name: "Mark 1 as reimbursed" }));
	try {
		await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(1));
		edge.included = true;
		await refresh(c);
		const retired = blocked();
		expect(within(retired).getByRole("button", { name: "Cancel", exact: true })).toHaveProperty(
			"disabled",
			true,
		);
		await nativeSubmit(retired);
		fireEvent.keyDown(retired, { key: "Escape", code: "Escape" });
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(edge.writes).toHaveBeenCalledTimes(1);
	} finally {
		await act(async () => {
			finish({ success: false, error: "Unauthorized" });
			await held;
		});
	}
	await waitFor(() =>
		expect(
			within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel", exact: true }),
		).toHaveProperty("disabled", false),
	);
	expect(screen.queryByText(failureMessage)).toBeNull();
	blocked();
	expect(edge.writes).toHaveBeenCalledTimes(1);
});

it("Activity reconnection cannot revive an explicitly retired captured reimbursement", async () => {
	const c = mount();
	await open();
	edge.included = true;
	await refresh(c);
	blocked();
	await act(async () => c.setHidden(true));
	await act(async () => c.setHidden(false));
	await screen.findByText(/Included in Payroll run/);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.getByRole("button", { name: "Mark as reimbursed", exact: true })).toHaveProperty(
		"disabled",
		true,
	);
	expect(edge.writes).not.toHaveBeenCalled();
});

it("fresh retirement before queued TanStack validation dispatches no captured reimbursement", async () => {
	const items = [{ account: account(), label: title }];
	const finished = vi.fn(),
		closed = vi.fn();
	const page = (retired = false) => (
		<BulkReimbursementDialog
			items={items}
			open
			retired={retired}
			onFinished={finished}
			onOpenChange={closed}
		/>
	);
	const view = render(page());
	const dialog = screen.getByRole("dialog");
	fireEvent.change(within(dialog).getByLabelText(/Payment reference/), {
		target: { value: "INDEPENDENT-BANK-48" },
	});
	const form = within(dialog)
		.getByLabelText(/Payment reference/)
		.closest("form");
	act(() => {
		if (form) fireEvent.submit(form);
		expect(edge.writes).not.toHaveBeenCalled();
		flushSync(() => view.rerender(page(true)));
	});
	await act(async () => {
		await Promise.resolve();
	});
	blocked();
	expect(edge.writes).not.toHaveBeenCalled();
	expect(finished).not.toHaveBeenCalled();
	expect(closed).not.toHaveBeenCalled();
});

// Retained from the independent public reproduction; only the response helper is local.
it("PRIORITY independent: omission on an empty refreshed page retains the open draft and exact retry intent", async () => {
	const queue = mount();
	const d = await open();
	fireEvent.change(within(d).getByLabelText(/Note/), { target: { value: "Synthetic retry note" } });
	await submit();
	const first = structuredClone(edge.writes.mock.calls[0][0]);
	edge.reads.mockResolvedValueOnce(reply([]));
	await refresh(queue);
	const retained = screen.queryByRole("dialog");
	expect(
		retained,
		"An empty filtered-page omission is not permission to discard the captured payment draft",
	).not.toBeNull();
	expect(within(retained!).getByLabelText(/Payment reference/)).toHaveProperty(
		"value",
		"INDEPENDENT-BANK-48",
	);
	expect(within(retained!).getByLabelText(/Note/)).toHaveProperty("value", "Synthetic retry note");
	await refresh(queue);
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(2);
	expect(edge.writes.mock.calls[1][0]).toEqual(first);
});

it("an empty page after a lost acknowledgement retains the exact values and idempotency key on direct retry", async () => {
	edge.writes.mockRejectedValueOnce(
		Error("Synthetic lost acknowledgement; no persistence simulated"),
	);
	const queue = mount(),
		dialog = await open();
	fireEvent.change(within(dialog).getByLabelText(/Note/), {
		target: { value: "Exact retained bank note" },
	});
	await submit();
	const first = structuredClone(edge.writes.mock.calls[0][0]);
	edge.reads.mockResolvedValueOnce(reply([]));
	await refresh(queue);
	expect(screen.getByRole("dialog")).toBe(dialog);
	expect(within(dialog).getByLabelText(/Note/)).toHaveProperty("value", "Exact retained bank note");
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(2);
	expect(edge.writes.mock.calls[1][0]).toEqual(first);
});

it("empty-page transitions keep an unsettled reimbursement reserved and retain its retry key after settlement", async () => {
	let finish: (value: { success: false; error: string }) => void = () => {
		throw Error("No dispatched request");
	};
	const held = new Promise<{ success: false; error: string }>((resolve) => {
		finish = resolve;
	});
	edge.writes.mockReturnValueOnce(held);
	const queue = mount(),
		dialog = await open();
	fireEvent.click(within(dialog).getByRole("button", { name: "Mark 1 as reimbursed" }));
	try {
		await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(1));
		edge.reads.mockResolvedValueOnce(reply([]));
		await refresh(queue);
		expect(screen.getByRole("dialog")).toBe(dialog);
		expect(within(dialog).getByRole("button", { name: "Cancel", exact: true })).toHaveProperty(
			"disabled",
			true,
		);
		await nativeSubmit(dialog);
		fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
		expect(screen.getByRole("dialog")).toBe(dialog);
		expect(edge.writes).toHaveBeenCalledTimes(1);
		await refresh(queue);
		await nativeSubmit(dialog);
		expect(edge.writes).toHaveBeenCalledTimes(1);
	} finally {
		await act(async () => {
			finish({ success: false, error: "Unauthorized" });
			await held;
		});
	}
	await screen.findByText(failureMessage);
	const first = structuredClone(edge.writes.mock.calls[0][0]);
	await submit();
	expect(edge.writes).toHaveBeenCalledTimes(2);
	expect(edge.writes.mock.calls[1][0]).toEqual(first);
});

it("an explicitly retired draft stays visible and blocked through empty and restored pages", async () => {
	const queue = mount();
	const dialog = await open();
	edge.included = true;
	await refresh(queue);
	blocked();
	edge.reads.mockResolvedValueOnce(reply([]));
	await refresh(queue);
	expect(screen.getByRole("dialog")).toBe(dialog);
	await nativeSubmit(blocked());
	edge.included = false;
	await refresh(queue);
	await nativeSubmit(blocked());
	expect(edge.writes).not.toHaveBeenCalled();
});

it("an empty-page capability refusal closes the draft and a later grant cannot reopen it", async () => {
	const queue = mount();
	await open();
	edge.reads.mockResolvedValueOnce(reply([], false));
	await refresh(queue);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await refresh(queue);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});

it.each([
	{ refreshedRows: "unchanged", empty: false },
	{ refreshedRows: "empty", empty: true },
])(
	"returns focus to the finance queue after Cancel with $refreshedRows rows",
	async ({ empty }) => {
		const queue = mount();
		await screen.findByRole("link", { name: new RegExp(title) });
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Select all expenses awaiting reimbursement on this page",
			}),
		);
		const opener = screen.getByRole("button", { name: "Mark as reimbursed", exact: true });
		opener.focus();
		fireEvent.click(opener);
		const dialog = await screen.findByRole("dialog");
		within(dialog)
			.getByLabelText(/Payment reference/)
			.focus();
		edge.reads.mockResolvedValueOnce(reply(empty ? [] : [account()]));
		await refresh(queue);
		expect(opener.isConnected).toBe(!empty);
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel", exact: true }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		const destination = empty ? screen.getByRole("heading", { name: "Approved expenses" }) : opener;
		await waitFor(() => expect(document.activeElement).toBe(destination));
		expect(edge.writes).not.toHaveBeenCalled();
	},
);

it("keeps the mixed reimbursement outcome while withholding the label of a refused report", async () => {
	const available = account();
	const refused = account();
	refused.source = { type: "report", id: "0892fc1f-ad7a-4c29-847f-a1ae86a45adc" };
	refused.employeeName = "Synthetic excluded employee";
	refused.title = {
		kind: "trip",
		purpose: "Synthetic excluded report",
		startDate: null,
		endDate: null,
	};
	edge.reads.mockResolvedValueOnce(reply([available, refused]));
	const queue = mount();
	const dialog = await open();
	edge.reads.mockResolvedValueOnce(reply([available]));
	await refresh(queue);
	edge.writes.mockResolvedValueOnce({
		success: true,
		data: {
			status: "processed",
			rows: [
				{
					source: available.source,
					outcome: "reimbursed",
					amount: "48.00",
					currency: "EUR",
					replayed: false,
				},
				{
					source: refused.source,
					outcome: "out_of_scope",
					amount: null,
					currency: null,
					replayed: false,
				},
			],
		},
	});
	fireEvent.click(within(dialog).getByRole("button", { name: "Mark 2 as reimbursed" }));
	const results = await screen.findByRole("dialog", { name: "Reimbursement results" });
	expect(within(results).getByText("1 of 2 reimbursed")).toBeTruthy();
	expect(within(results).getByText(new RegExp(title))).toBeTruthy();
	expect(within(results).getByText("Skipped: out of scope")).toBeTruthy();
	expect(
		within(results).queryByText(/Synthetic excluded employee|Synthetic excluded report/),
	).toBeNull();
	expect(edge.writes).toHaveBeenCalledTimes(1);
});

it.each([
	{ dismiss: "Done", empty: true },
	{ dismiss: "Done", empty: false },
	{ dismiss: "Escape", empty: false },
])(
	"returns focus to the queue after $dismiss closes results (empty queue: $empty)",
	async ({ dismiss, empty }) => {
		const queue = mount();
		const dialog = await open();
		const opener = screen.getByRole("button", {
			name: "Mark as reimbursed",
			exact: true,
			hidden: true,
		});
		if (empty) {
			edge.reads.mockResolvedValue(reply([]));
			await refresh(queue);
		}
		edge.writes.mockResolvedValueOnce({
			success: true,
			data: {
				status: "processed",
				rows: [
					{
						source: account().source,
						outcome: "reimbursed",
						amount: "48.00",
						currency: "EUR",
						replayed: false,
					},
				],
			},
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Mark 1 as reimbursed" }));
		const results = await screen.findByRole("dialog", { name: "Reimbursement results" });
		expect(within(results).getByText("1 of 1 reimbursed")).toBeTruthy();
		const done = within(results).getByRole("button", { name: "Done" });
		done.focus();
		if (dismiss === "Escape") fireEvent.keyDown(done, { key: "Escape", code: "Escape" });
		else fireEvent.click(done);

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(opener.isConnected).toBe(!empty);
		if (!empty) expect(opener).toHaveProperty("disabled", true);
		const heading = screen.getByRole("heading", { name: "Approved expenses" });
		await waitFor(() => expect(document.activeElement).toBe(heading));

		if (!empty && dismiss === "Done") {
			await waitFor(() => {
				const chooser = screen.getByRole("checkbox", {
					name: "Select all expenses awaiting reimbursement on this page",
				});
				expect(chooser.getAttribute("aria-disabled")).not.toBe("true");
				expect(chooser.hasAttribute("disabled")).toBe(false);
			});
			const nextDialog = await open();
			within(nextDialog)
				.getByLabelText(/Payment reference/)
				.focus();
			fireEvent.click(within(nextDialog).getByRole("button", { name: "Cancel", exact: true }));
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			await waitFor(() => expect(document.activeElement).toBe(opener));
		}
		expect(edge.writes).toHaveBeenCalledTimes(1);
	},
);
