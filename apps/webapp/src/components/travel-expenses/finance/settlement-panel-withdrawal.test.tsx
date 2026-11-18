/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const edge = vi.hoisted(() => ({ mode: "success", calls: [] as string[], writes: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_: string, fallback: string, p?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (m, n) => String(p?.[n] ?? m)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: false,
		data: { user: { id: "review-reader" }, session: { activeOrganizationId: "review-org" } },
	}),
	authClient: {
		$store: {
			atoms: {
				session: {
					get: () => ({
						isPending: false,
						data: {
							user: { id: "review-reader" },
							session: { activeOrganizationId: "review-org" },
						},
					}),
					subscribe: () => () => {},
				},
			},
		},
	},
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseSettlement: async (source: { type: string; id: string }) => {
		edge.calls.push(edge.mode);
		if (edge.mode === "refusal") return { success: false, error: "Not found" };
		if (edge.mode === "thrown-refusal") throw new Error("Not found");
		if (edge.mode === "rejection") throw new TypeError("Review transport unavailable");
		if (edge.mode === "outage") return { success: false, error: "Review service unavailable" };
		return {
			success: true,
			data: { account: account(source), viewer: "finance", canSettle: true },
		};
	},
	recordTravelExpenseReimbursementAction: edge.writes,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-recovery-actions", () => ({
	recordTravelExpenseRecoveryAction: edge.writes,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-actions", () => ({
	getTravelExpenseReportSubmission: async () => ({ success: true, data: report }),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/report-reopen-actions", () => ({
	getTravelExpenseReportReopenState: async () => ({
		success: true,
		data: { status: "not_allowed" },
	}),
	reopenTravelExpenseReportAction: edge.writes,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/legacy-draft-actions", () => ({
	convertLegacyTravelExpenseDraftAction: edge.writes,
	getLegacyTravelExpenseConversion: edge.writes,
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
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { SubmittedTravelExpenseReport } from "@/components/travel-expenses/report/submitted-report";
import { TravelExpenseClaimDetail } from "@/components/travel-expenses/travel-expense-claim-detail";

const id = "4053401f-806e-4839-ae66-96b9fa36c054";
const evidence = "REVIEW_PRIVATE_SETTLEMENT_NOTE";
function account(source: { type: string; id: string }) {
	return {
		source,
		organizationId: "review-org",
		employeeId: "another-employee",
		employeeName: "Review Employee",
		approved: true,
		currency: "EUR",
		basis: {
			evidence: "frozen_revision",
			revisionId: "revision",
			submissionCycle: 1,
			approvedAt: "2026-09-20T10:00:00Z",
			companyPaid: "0.00",
		},
		entitlement: [
			{ kind: "approved_submission", id: "revision", currency: "EUR", amount: "89.90" },
		],
		entries: [
			{
				id: "entry",
				kind: "reimbursement",
				amount: "20.50",
				currency: "EUR",
				occurredOn: "2026-10-01",
				reference: "REVIEW-REF",
				note: edge.mode === "fresh" ? "CURRENT_AUTHORIZED_SETTLEMENT_NOTE" : evidence,
				balanceBefore: "89.90",
				recordedAt: "2026-10-01T09:00:00Z",
				recordedByUserId: "review-reader",
				recordedByName: "Review Recorder",
				exportBatch: null,
				payrollRun: null,
			},
		],
		summary: {
			state: "outstanding",
			currencies: [
				{
					currency: "EUR",
					entitlement: "89.90",
					reimbursed: "20.50",
					recovered: "0.00",
					balance: "69.40",
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
	};
}
const claim = {
	claim: {
		id,
		organizationId: "review-org",
		employeeId: "another-employee",
		type: "receipt",
		status: "approved",
		tripStartDate: null,
		tripEndDate: null,
		tripDateTimeZone: null,
		originalAmount: "89.90",
		originalCurrency: "EUR",
		calculatedAmount: "89.90",
		calculatedCurrency: "EUR",
		destinationCity: "Hamburg",
		destinationCountry: "DE",
		notes: "Review claim evidence",
		submittedAt: "2026-04-01T10:00:00Z",
		createdAt: "2026-03-28T10:00:00Z",
		decidedAt: "2026-04-02T10:00:00Z",
	},
	attachments: [],
	decisions: [],
	intermediateDecisions: [],
};
const report = {
	access: "reviewer",
	status: "approved",
	submissionCycle: 1,
	latestCycle: 1,
	submittedAt: "2026-04-01T10:00:00Z",
	facts: {
		reportKind: "standalone",
		trip: null,
		items: [],
		totals: { currency: "EUR", reimbursable: "89.90", companyPaid: "0.00" },
	},
	decision: null,
	returned: null,
	reopened: null,
	cycleOutcome: "approved",
	canAddReceipt: false,
	history: [],
	cycles: [],
};
const bootstrap = {
	userId: "review-reader",
	organizationId: "review-org",
	employee: {
		employeeId: "review-employee",
		organizationId: "review-org",
		role: "employee" as const,
	},
	organizationSettings: null,
	updatedAt: Date.now(),
};
const clients: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.unstubAllGlobals();
	edge.calls = [];
	edge.writes.mockReset();
});
function mount(kind: "legacy" | "report") {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url === "/api/auth/context")
				return Response.json({
					user: { id: "review-reader" },
					session: { activeOrganizationId: "review-org" },
					employee: bootstrap.employee,
					organizationSettings: null,
				});
			expect(url).toBe(`/api/travel-expenses/${id}`);
			return Response.json(claim);
		}),
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } },
	});
	clients.push(client);
	render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={bootstrap}>
				{kind === "legacy" ? (
					<TravelExpenseClaimDetail
						userId="review-reader"
						organizationId="review-org"
						employeeId="review-employee"
						claimId={id}
					/>
				) : (
					<SubmittedTravelExpenseReport reportId={id} />
				)}
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	return client;
}
async function reread(client: QueryClient, mode: string) {
	edge.mode = mode;
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["travel-expenses", "settlement"] });
	});
}
const refreshError =
	"The balance could not be refreshed. Previously loaded records are shown; retry before recording a payment.";
for (const kind of ["legacy", "report"] as const) {
	it(`control ${kind}: initial Not found and subsequent outage disclose no settlement; fresh success restores`, async () => {
		edge.mode = "refusal";
		const c = mount(kind);
		await waitFor(() => expect(edge.calls).toEqual(["refusal"]));
		await waitFor(() => expect(screen.queryByText("Loading reimbursement balance…")).toBeNull());
		expect(screen.queryByText(evidence)).toBeNull();
		await reread(c, "outage");
		await screen.findByText("Unable to load the reimbursement balance. Please retry.");
		expect(screen.queryByText(evidence)).toBeNull();
		await reread(c, "success");
		await screen.findByText(evidence);
		expect(edge.writes).not.toHaveBeenCalled();
	});
	it(`control ${kind}: ordinary authorized outage retains exact draft disabled and recovers`, async () => {
		edge.mode = "success";
		const c = mount(kind);
		await screen.findByText(evidence);
		const input = screen.getByLabelText("Payment reference");
		if (!(input instanceof HTMLInputElement)) throw new Error("Expected payment reference input");
		fireEvent.change(input, { target: { value: "REVIEW EXACT DRAFT" } });
		await reread(c, "outage");
		await screen.findByText(refreshError);
		expect(screen.getByText(evidence)).toBeTruthy();
		expect(screen.getByLabelText("Payment reference")).toHaveProperty(
			"value",
			"REVIEW EXACT DRAFT",
		);
		expect(input.closest("fieldset")?.disabled).toBe(true);
		await reread(c, "success");
		await waitFor(() => expect(screen.queryByText(refreshError)).toBeNull());
		expect(screen.getByLabelText("Payment reference")).toHaveProperty(
			"value",
			"REVIEW EXACT DRAFT",
		);
		expect(input.closest("fieldset")?.disabled).toBe(false);
		expect(edge.writes).not.toHaveBeenCalled();
	});
	for (const transient of ["outage", "rejection"] as const) {
		it(`${kind}: Not found withdraws evidence through repeated ${transient}; only fresh success restores it`, async () => {
			edge.mode = "success";
			const c = mount(kind);
			await screen.findByText(evidence);
			await reread(c, "refusal");
			await waitFor(() => expect(screen.queryByText(evidence)).toBeNull());
			expect(screen.queryByRole("region", { name: "Reimbursement", exact: true })).toBeNull();
			for (let attempt = 0; attempt < 2; attempt++) {
				await reread(c, transient);
				await screen.findByText("Unable to load the reimbursement balance. Please retry.");
				expect(screen.queryByText(evidence)).toBeNull();
				expect(screen.queryByRole("region", { name: "Reimbursement", exact: true })).toBeNull();
				expect(screen.queryByLabelText("Payment reference")).toBeNull();
				expect(screen.queryByText(refreshError)).toBeNull();
			}
			edge.mode = "fresh";
			fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
			await screen.findByText("CURRENT_AUTHORIZED_SETTLEMENT_NOTE");
			expect(screen.queryByText(evidence)).toBeNull();
			await waitFor(() =>
				expect(
					screen.queryByText("Unable to load the reimbursement balance. Please retry."),
				).toBeNull(),
			);
			expect(edge.writes).not.toHaveBeenCalled();
		});
	}
	it(`${kind}: thrown Not found has the same durable withdrawal and local Retry`, async () => {
		edge.mode = "success";
		const c = mount(kind);
		await screen.findByText(evidence);
		await reread(c, "thrown-refusal");
		await waitFor(() => expect(screen.queryByText(evidence)).toBeNull());
		await reread(c, "outage");
		await screen.findByText("Unable to load the reimbursement balance. Please retry.");
		expect(screen.queryByLabelText("Payment reference")).toBeNull();
		edge.mode = "fresh";
		fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
		await screen.findByText("CURRENT_AUTHORIZED_SETTLEMENT_NOTE");
		expect(screen.queryByText(evidence)).toBeNull();
		expect(edge.writes).not.toHaveBeenCalled();
	});
	it(`${kind}: a payment completing after withdrawal cannot restore the old account`, async () => {
		edge.mode = "success";
		const c = mount(kind);
		await screen.findByText(evidence);
		const settledAccount = account({ type: kind === "legacy" ? "legacy_claim" : "report", id });
		let finish = (_value: {
			success: true;
			data: { status: "recorded"; replayed: false; account: typeof settledAccount };
		}) => {
			throw new Error("Payment not started");
		};
		edge.writes.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		fireEvent.change(screen.getByLabelText("Payment date"), { target: { value: "2026-10-01" } });
		fireEvent.change(screen.getByLabelText("Payment reference"), {
			target: { value: "REVIEW PENDING PAYMENT" },
		});
		fireEvent.submit(screen.getByRole("form", { name: "Record a reimbursement" }));
		await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(1));
		await reread(c, "refusal");
		await waitFor(() => expect(screen.queryByText(evidence)).toBeNull());
		edge.mode = "outage";
		await act(async () => {
			finish({
				success: true,
				data: { status: "recorded", replayed: false, account: settledAccount },
			});
		});
		await reread(c, "outage");
		await screen.findByText("Unable to load the reimbursement balance. Please retry.");
		expect(screen.queryByText(evidence)).toBeNull();
		expect(screen.queryByLabelText("Payment reference")).toBeNull();
		expect(edge.writes).toHaveBeenCalledTimes(1);
	});
}
