/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettlementAccount } from "@/lib/travel-expenses/settlement-store";

const mocks = vi.hoisted(() => ({
	getSettlement: vi.fn(),
	record: vi.fn(),
	recover: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseSettlement: mocks.getSettlement,
	recordTravelExpenseReimbursementAction: mocks.record,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-recovery-actions", () => ({
	recordTravelExpenseRecoveryAction: mocks.recover,
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		name,
	}: {
		value: string;
		onChange: (value: string) => void;
		name: string;
	}) => (
		<input
			aria-label="Payment date"
			name={name}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		/>
	),
}));

import { SettlementPanel } from "./settlement-panel";

const source = { type: "report" as const, id: "6f0c4f8e-6d2a-4c38-9a53-6a3a1d1a1a11" };

function account(overrides: Partial<SettlementAccount> = {}): SettlementAccount {
	return {
		source,
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
		entitlement: [
			{ kind: "approved_submission", id: "revision", currency: "EUR", amount: "89.90" },
		],
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
		title: { kind: "trip", purpose: "Workshop", startDate: null, endDate: null },
		adjustments: [],
		adjustmentOf: null,
		adjustmentDelta: null,
		payrollRun: null,
		confirmedPayrollRuns: [],
		...overrides,
	};
}

const paid = (amount: string): SettlementAccount["entries"][number] => ({
	id: `entry-${amount}`,
	kind: "reimbursement",
	amount,
	currency: "EUR",
	occurredOn: "2026-10-01",
	reference: "SEPA-4711",
	note: null,
	balanceBefore: "89.90",
	recordedAt: "2026-10-01T09:00:00Z",
	recordedByUserId: "finance-user",
	recordedByName: "Fin Ance",
	exportBatch: null,
	payrollRun: null,
});

const paidFromExport = (amount: string): SettlementAccount["entries"][number] => ({
	...paid(amount),
	exportBatch: { id: "batch-1", requestedAt: "2026-10-01T12:00:00Z" },
});

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<SettlementPanel source={source} />
		</QueryClientProvider>,
	);
	return client;
}

async function fillAndSubmit(values: { amount?: string; date?: string; reference?: string }) {
	const amount = await screen.findByLabelText("Amount paid (EUR)");
	if (values.amount !== undefined) fireEvent.change(amount, { target: { value: values.amount } });
	fireEvent.change(screen.getByLabelText("Payment date"), {
		target: { value: values.date ?? "2026-10-01" },
	});
	fireEvent.change(screen.getByLabelText("Payment reference"), {
		target: { value: values.reference ?? "SEPA-4711" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Record reimbursement" }));
}

describe("settlement panel (#612)", () => {
	beforeEach(() => {
		mocks.getSettlement.mockReset();
		mocks.record.mockReset();
		mocks.recover.mockReset();
		mocks.toastSuccess.mockReset();
	});
	afterEach(cleanup);

	it("shows the employee their outstanding balance and recorded payments without any recording control", async () => {
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: {
				viewer: "owner",
				canSettle: false,
				account: account({
					entries: [{ ...paid("50.00"), recordedByName: null, recordedByUserId: null }],
					summary: {
						state: "outstanding",
						currencies: [
							{
								currency: "EUR",
								entitlement: "89.90",
								reimbursed: "50.00",
								recovered: "0.00",
								balance: "39.90",
								state: "outstanding",
							},
						],
					},
				}),
			},
		});
		mount();
		expect(await screen.findByText("€39.90 outstanding")).toBeTruthy();
		expect(screen.getByText("Awaiting reimbursement")).toBeTruthy();
		expect(
			screen.getByText(
				"Finance records each payment here. Once everything owed to you is paid, this expense shows as Reimbursed.",
			),
		).toBeTruthy();
		expect(screen.getByText("Paid €50.00")).toBeTruthy();
		expect(screen.getByText("SEPA-4711")).toBeTruthy();
		expect(
			screen.getByText("Company-paid costs of €240.00 are not owed to the employee."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Record reimbursement" })).toBeNull();
		expect(screen.queryByText(/Recorded by/)).toBeNull();
	});

	it("names the export batch a payment was marked from, for finance only (#755)", async () => {
		const settled = {
			state: "settled" as const,
			currencies: [
				{
					currency: "EUR",
					entitlement: "89.90",
					reimbursed: "89.90",
					recovered: "0.00",
					balance: "0.00",
					state: "settled" as const,
				},
			],
		};
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: {
				viewer: "finance",
				canSettle: true,
				account: account({ entries: [paidFromExport("89.90")], summary: settled }),
			},
		});
		mount();
		expect(await screen.findByText(/^From the export requested /)).toBeTruthy();
		cleanup();

		// The employee's own view never carries the batch.
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: {
				viewer: "owner",
				canSettle: false,
				account: account({ entries: [paid("89.90")], summary: settled }),
			},
		});
		mount();
		expect(await screen.findByText("Paid €89.90")).toBeTruthy();
		expect(screen.queryByText(/From the export/)).toBeNull();
	});

	it("names the payroll run that paid a reimbursement instead of its reference, for the employee too (#853)", async () => {
		const settled = {
			state: "settled" as const,
			currencies: [
				{
					currency: "EUR",
					entitlement: "70.00",
					reimbursed: "70.00",
					recovered: "0.00",
					balance: "0.00",
					state: "settled" as const,
				},
			],
		};
		const entry = {
			...paid("70.00"),
			reference: "Payroll run 2026-10 (DATEV Lohn & Gehalt)",
			payrollRun: { id: "run-1", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
		};
		for (const viewer of ["finance", "owner"] as const) {
			mocks.getSettlement.mockResolvedValue({
				success: true,
				data: {
					viewer,
					canSettle: viewer === "finance",
					account: account({ entries: [entry], summary: settled }),
				},
			});
			mount();
			expect(await screen.findByText("Reimbursed with payroll October 2026")).toBeTruthy();
			expect(screen.queryByText("Payroll run 2026-10 (DATEV Lohn & Gehalt)")).toBeNull();
			cleanup();
		}
	});

	it("shows an overpayment as such instead of clamping it to zero", async () => {
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: {
				viewer: "finance",
				canSettle: true,
				account: account({
					summary: {
						state: "overpaid",
						currencies: [
							{
								currency: "EUR",
								entitlement: "450.00",
								reimbursed: "500.00",
								recovered: "0.00",
								balance: "-50.00",
								state: "overpaid",
							},
						],
					},
				}),
			},
		});
		mount();
		expect(await screen.findByText("€50.00 overpaid")).toBeTruthy();
		expect(screen.getByText("Overpaid")).toBeTruthy();
		// Nothing is outstanding, so no reimbursement can be recorded.
		expect(screen.queryByRole("button", { name: "Record reimbursement" })).toBeNull();
	});

	it("renders nothing for someone who may not see the settlement (e.g. the approving manager)", async () => {
		mocks.getSettlement.mockResolvedValue({ success: false, error: "Not found" });
		const { container } = render(
			<QueryClientProvider
				client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
			>
				<SettlementPanel source={source} />
			</QueryClientProvider>,
		);
		await waitFor(() => expect(mocks.getSettlement).toHaveBeenCalled());
		await waitFor(() => expect(container.textContent).toBe(""));
	});

	it("lets finance record a reimbursement against the balance shown and reuses the key when retrying the same payment", async () => {
		const settled = account({
			entries: [paid("89.90")],
			summary: {
				state: "settled",
				currencies: [
					{
						currency: "EUR",
						entitlement: "89.90",
						reimbursed: "89.90",
						recovered: "0.00",
						balance: "0.00",
						state: "settled",
					},
				],
			},
		});
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: { viewer: "finance", canSettle: true, account: account() },
		});
		mocks.record
			.mockResolvedValueOnce({ success: false, error: "Failed to record the reimbursement" })
			.mockResolvedValueOnce({
				success: true,
				data: { status: "recorded", replayed: true, account: settled },
			});
		mount();

		await fillAndSubmit({});
		expect(
			await screen.findByText("The payment could not be recorded. Please retry."),
		).toBeTruthy();
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: { viewer: "finance", canSettle: true, account: settled },
		});
		fireEvent.click(screen.getByRole("button", { name: "Record reimbursement" }));

		await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2));
		const [first, second] = mocks.record.mock.calls.map(([input]) => input);
		expect(first).toEqual({
			source,
			idempotencyKey: expect.any(String),
			amount: "89.90",
			occurredOn: "2026-10-01",
			reference: "SEPA-4711",
			note: null,
			expectedBalance: { currency: "EUR", amount: "89.90" },
		});
		expect(second.idempotencyKey).toBe(first.idempotencyKey);
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith("This payment was already recorded."),
		);
		expect(await screen.findByText("Reimbursed", { selector: "p *, p" })).toBeTruthy();
		expect(screen.queryByText(/settled/i)).toBeNull();
	});

	it("explains a balance that changed meanwhile and validates the entry before sending it", async () => {
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: { viewer: "finance", canSettle: true, account: account() },
		});
		mocks.record.mockResolvedValue({
			success: true,
			data: { status: "refused", reason: "stale_balance", account: account() },
		});
		mount();

		await fillAndSubmit({ amount: "0", reference: " " });
		expect(await screen.findByText("Enter a positive amount.")).toBeTruthy();
		expect(
			screen.getByText("Enter the payment reference, e.g. the bank transfer reference."),
		).toBeTruthy();
		expect(mocks.record).not.toHaveBeenCalled();

		await fillAndSubmit({ amount: "89.90" });
		expect(
			await screen.findByText(
				"The balance changed while you were entering this payment. Check the updated balance and record it again.",
			),
		).toBeTruthy();
	});

	it("clears a field error as soon as its value is valid, without submitting again (#688)", async () => {
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: { viewer: "finance", canSettle: true, account: account() },
		});
		mount();
		const amount = await screen.findByLabelText("Amount paid (EUR)");
		fireEvent.change(amount, { target: { value: "0" } });
		expect(screen.getAllByText("Enter a positive amount.")).toHaveLength(1);
		fireEvent.change(amount, { target: { value: "12.50" } });
		expect(screen.queryByText("Enter a positive amount.")).toBeNull();

		// Untouched required fields show their error once the form is submitted.
		fireEvent.click(screen.getByRole("button", { name: "Record reimbursement" }));
		const missing = "Enter the payment reference, e.g. the bank transfer reference.";
		expect(await screen.findAllByText(missing)).toHaveLength(1);
		expect(screen.getAllByText("Enter the payment date.")).toHaveLength(1);
		expect(mocks.record).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("Payment reference"), {
			target: { value: "SEPA-4711" },
		});
		expect(screen.queryByText(missing)).toBeNull();
		expect(screen.getByText("Enter the payment date.")).toBeTruthy();
	});

	it("keeps a field error the server returned until that field changes (#688)", async () => {
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: { viewer: "finance", canSettle: true, account: account() },
		});
		mocks.record.mockResolvedValue({
			success: true,
			data: { status: "invalid", errors: [{ field: "reference", code: "too_long" }] },
		});
		mount();
		await fillAndSubmit({});
		expect(await screen.findAllByText("This text is too long.")).toHaveLength(1);
		fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-10-02" } });
		expect(screen.getByText("This text is too long.")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Payment reference"), {
			target: { value: "SEPA-4712" },
		});
		expect(screen.queryByText("This text is too long.")).toBeNull();
	});

	it("shows an approved adjustment and lets finance record the recovery of the overpayment (#615)", async () => {
		const overpaid = account({
			entitlement: [
				{ kind: "approved_submission", id: "revision", currency: "EUR", amount: "500.00" },
				{ kind: "approved_adjustment", id: "adj-revision", currency: "EUR", amount: "-50.00" },
			],
			adjustments: [
				{
					reportId: "adjustment-report",
					revisionId: "adj-revision",
					delta: "-50.00",
					currency: "EUR",
					reason: "Hotel refunded one night",
					approvedAt: "2026-10-03T08:00:00Z",
				},
			],
			entries: [{ ...paid("500.00"), balanceBefore: "500.00" }],
			summary: {
				state: "overpaid",
				currencies: [
					{
						currency: "EUR",
						entitlement: "450.00",
						reimbursed: "500.00",
						recovered: "0.00",
						balance: "-50.00",
						state: "overpaid",
					},
				],
			},
		});
		mocks.getSettlement.mockResolvedValue({
			success: true,
			data: { viewer: "finance", canSettle: true, account: overpaid },
		});
		mocks.recover.mockResolvedValue({
			success: true,
			data: { status: "recorded", replayed: false, account: account() },
		});
		mount();

		expect(await screen.findByText("€50.00 overpaid")).toBeTruthy();
		expect(screen.getByText("-€50.00")).toBeTruthy();
		expect(screen.getByText("Hotel refunded one night")).toBeTruthy();
		// The overpayment is entered as a positive amount recovered.
		const amount = screen.getByLabelText("Amount recovered (EUR)") as HTMLInputElement;
		expect(amount.value).toBe("50.00");
		fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-10-05" } });
		fireEvent.change(screen.getByLabelText("Payment reference"), {
			target: { value: "RECOVERY-77" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Record recovery" }));

		await waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(1));
		expect(mocks.record).not.toHaveBeenCalled();
		expect(mocks.recover.mock.calls[0]?.[0]).toMatchObject({
			amount: "50.00",
			occurredOn: "2026-10-05",
			reference: "RECOVERY-77",
			expectedBalance: { currency: "EUR", amount: "-50.00" },
		});
		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Recovery recorded."));
	});
});
