/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const edge = vi.hoisted(() => ({
	mode: "success",
	calls: [] as string[],
	actor: "review-reader",
	org: "review-org",
	pending: false,
	absent: false,
	employee: "review-employee" as string | null,
	role: "employee",
	contextMode: "success",
	contextCalls: 0,
	contextHolds: [] as ((response: Response) => void)[],
	feedback: vi.fn(),
	writes: vi.fn(),
	holds: [] as ((value: unknown) => void)[],
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_: string, fallback: string, p?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (m, n) => String(p?.[n] ?? m)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("sonner", () => ({ toast: { success: edge.feedback } }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: edge.pending,
		data: edge.absent
			? null
			: { user: { id: edge.actor }, session: { activeOrganizationId: edge.org } },
	}),
	authClient: {
		$store: {
			atoms: {
				session: {
					get: () => ({
						isPending: edge.pending,
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
		if (edge.mode === "held") return await new Promise((resolve) => edge.holds.push(resolve));
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

import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
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
	edge.actor = "review-reader";
	edge.org = "review-org";
	edge.pending = false;
	edge.absent = false;
	edge.employee = "review-employee";
	edge.role = "employee";
	edge.contextMode = "success";
	edge.contextCalls = 0;
	edge.contextHolds = [];
	edge.feedback.mockReset();
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	vi.unstubAllGlobals();
	edge.calls = [];
	edge.writes.mockReset();
	edge.holds = [];
});
function mount(kind: "legacy" | "report") {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url !== "/api/auth/context") return Response.json(claim);
			edge.contextCalls++;
			if (edge.contextMode === "outage")
				return Response.json({ error: "Synthetic context unavailable" }, { status: 503 });
			if (edge.contextMode === "held")
				return await new Promise<Response>((resolve) => edge.contextHolds.push(resolve));
			return contextResponse();
		}),
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } },
	});
	clients.push(client);
	const consumer = (name: typeof kind) =>
		name === "legacy" ? (
			<TravelExpenseClaimDetail
				userId="review-reader"
				organizationId="review-org"
				employeeId="review-employee"
				claimId={id}
			/>
		) : (
			<SubmittedTravelExpenseReport reportId={id} />
		);
	const tree = (name: typeof kind, mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={bootstrap}>
				<ScopeReceipt />
				<Activity mode={mode}>{consumer(name)}</Activity>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(tree(kind));
	return {
		client,
		show: (name = kind, mode: "visible" | "hidden" = "visible") => view.rerender(tree(name, mode)),
	};
}
const noData = "Unable to load the reimbursement balance. Please retry.";

function ScopeReceipt() {
	const context = useOrganization();
	return <output aria-label="Observed employee">{context.employeeId ?? "missing-employee"}</output>;
}
it("control real provider unchanged employee refresh retains the authorized settlement", async () => {
	edge.mode = "success";
	const v = mount("report");
	await screen.findByText(evidence);
	await act(async () => {
		await v.client.invalidateQueries({ queryKey: ["organization-context"] });
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Observed employee")).toHaveProperty(
			"textContent",
			"review-employee",
		),
	);
	expect(screen.getByText(evidence)).toBeTruthy();
	expect(edge.writes).not.toHaveBeenCalled();
});
it("control actual legacy consumer hides settlement on observed missing employee without a server write", async () => {
	edge.mode = "success";
	const v = mount("legacy");
	await screen.findByText(evidence);
	edge.employee = null;
	edge.mode = "refusal";
	await act(async () => {
		await v.client.invalidateQueries({ queryKey: ["organization-context"] });
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Observed employee")).toHaveProperty(
			"textContent",
			"missing-employee",
		),
	);
	expect(screen.queryByText(evidence)).toBeNull();
	expect(screen.queryByLabelText("Payment reference")).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});
it("PRIORITY actual submitted report withdraws settlement when real provider observes missing employee in same actor and organization", async () => {
	edge.mode = "success";
	const v = mount("report");
	await screen.findByText(evidence);
	edge.employee = null;
	edge.mode = "refusal";
	await act(async () => {
		await v.client.invalidateQueries({ queryKey: ["organization-context"] });
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Observed employee")).toHaveProperty(
			"textContent",
			"missing-employee",
		),
	);
	expect(edge.writes).not.toHaveBeenCalled();
	expect(
		screen.queryByText(evidence),
		"Observed employee loss must not leave finance evidence current",
	).toBeNull();
	expect(screen.queryByLabelText("Payment reference")).toBeNull();
});

function contextResponse() {
	return Response.json({
		user: { id: edge.actor },
		session: { activeOrganizationId: edge.org },
		employee: edge.employee
			? { employeeId: edge.employee, organizationId: edge.org, role: edge.role }
			: null,
		organizationSettings: null,
	});
}
function settlementResponse(note = "CURRENT_AUTHORIZED_SETTLEMENT_NOTE") {
	const current = account({ type: "report", id });
	return {
		success: true,
		data: {
			account: { ...current, entries: current.entries.map((entry) => ({ ...entry, note })) },
			viewer: "finance",
			canSettle: true,
		},
	};
}
async function contextRefresh(client: QueryClient) {
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["organization-context"] });
	});
}
for (const kind of ["legacy", "report"] as const) {
	it(`${kind}: employee loss and context outage stay hidden; return needs a fresh settlement`, async () => {
		edge.mode = "success";
		const v = mount(kind);
		await screen.findByText(evidence);
		edge.employee = null;
		await contextRefresh(v.client);
		await waitFor(() =>
			expect(screen.getByLabelText("Observed employee")).toHaveProperty(
				"textContent",
				"missing-employee",
			),
		);
		expect(screen.queryByText(evidence)).toBeNull();
		expect(screen.queryByLabelText("Payment reference")).toBeNull();
		edge.contextMode = "outage";
		await contextRefresh(v.client);
		await screen.findByRole("button", { name: "Retry", exact: true });
		expect(screen.queryByText(evidence)).toBeNull();
		expect(screen.queryByLabelText("Payment reference")).toBeNull();
		edge.employee = "review-employee";
		edge.contextMode = "success";
		edge.mode = "held";
		fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
		await waitFor(() => expect(edge.holds).toHaveLength(1));
		expect(screen.queryByText(evidence)).toBeNull();
		expect(screen.queryByLabelText("Payment reference")).toBeNull();
		await act(async () => {
			edge.holds[0](settlementResponse());
		});
		await screen.findByText("CURRENT_AUTHORIZED_SETTLEMENT_NOTE");
		expect(screen.queryByText(evidence)).toBeNull();
		expect(edge.writes).not.toHaveBeenCalled();
	});
	it(`${kind}: role replacement retires the loaded settlement and refuses stale action targets`, async () => {
		edge.mode = "success";
		const v = mount(kind);
		await screen.findByText(evidence);
		edge.role = "manager";
		edge.mode = "held";
		await contextRefresh(v.client);
		await waitFor(() => expect(edge.holds).toHaveLength(1));
		expect(screen.queryByText(evidence)).toBeNull();
		expect(screen.queryByLabelText("Payment reference")).toBeNull();
		await act(async () => {
			edge.holds[0]({ success: false, error: "Not found" });
		});
		expect(screen.queryByText(evidence)).toBeNull();
		expect(edge.writes).not.toHaveBeenCalled();
	});
}
it("submitted report: employee replacement and return require distinct fresh reads; retired success stays hidden", async () => {
	edge.mode = "success";
	const v = mount("report");
	await screen.findByText(evidence);
	edge.employee = "replacement-employee";
	edge.mode = "held";
	await contextRefresh(v.client);
	await waitFor(() => expect(edge.holds).toHaveLength(1));
	expect(screen.queryByText(evidence)).toBeNull();
	edge.employee = "review-employee";
	await contextRefresh(v.client);
	await waitFor(() => expect(edge.holds).toHaveLength(2));
	await act(async () => {
		edge.holds[0](settlementResponse("RETIRED_EMPLOYEE_NOTE"));
	});
	expect(screen.queryByText("RETIRED_EMPLOYEE_NOTE")).toBeNull();
	expect(screen.queryByText(evidence)).toBeNull();
	expect(screen.queryByLabelText("Payment reference")).toBeNull();
	await act(async () => {
		edge.holds[1](settlementResponse());
	});
	await screen.findByText("CURRENT_AUTHORIZED_SETTLEMENT_NOTE");
	expect(screen.queryByText("RETIRED_EMPLOYEE_NOTE")).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});
it("submitted report: retained pending session hides evidence and cannot reuse it when proof returns", async () => {
	edge.mode = "success";
	const v = mount("report");
	await screen.findByText(evidence);
	edge.pending = true;
	v.show();
	expect(screen.queryByText(evidence)).toBeNull();
	expect(screen.queryByLabelText("Payment reference")).toBeNull();
	edge.pending = false;
	edge.mode = "held";
	v.show();
	await waitFor(() => expect(edge.holds).toHaveLength(1));
	expect(screen.queryByText(evidence)).toBeNull();
	await act(async () => {
		edge.holds[0](settlementResponse());
	});
	await screen.findByText("CURRENT_AUTHORIZED_SETTLEMENT_NOTE");
	expect(edge.writes).not.toHaveBeenCalled();
});
it("submitted report: context Retry is visible and disabled until the real provider read settles", async () => {
	edge.mode = "success";
	const v = mount("report");
	await screen.findByText(evidence);
	edge.contextMode = "outage";
	await contextRefresh(v.client);
	await screen.findByText(noData);
	expect(screen.queryByText(evidence)).toBeNull();
	edge.contextMode = "held";
	const before = edge.contextCalls;
	fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
	await waitFor(() => expect(edge.contextHolds).toHaveLength(1));
	expect(screen.getByRole("button", { name: "Retry", exact: true })).toHaveProperty(
		"disabled",
		true,
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
	expect(edge.contextCalls - before).toBe(1);
	edge.mode = "fresh";
	await act(async () => {
		edge.contextHolds[0](contextResponse());
	});
	await screen.findByText("CURRENT_AUTHORIZED_SETTLEMENT_NOTE");
	expect(screen.queryByText(evidence)).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});
it("submitted report: an unresolved payment cannot restore feedback or evidence after the employee disappears", async () => {
	edge.mode = "success";
	const v = mount("report");
	await screen.findByText(evidence);
	let finish = (_value: unknown) => {
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
		target: { value: "EXACT PENDING PROVIDER PAYMENT" },
	});
	fireEvent.submit(screen.getByRole("form", { name: "Record a reimbursement" }));
	await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(1));
	edge.employee = null;
	await contextRefresh(v.client);
	await waitFor(() =>
		expect(screen.getByLabelText("Observed employee")).toHaveProperty(
			"textContent",
			"missing-employee",
		),
	);
	expect(screen.queryByText(evidence)).toBeNull();
	await act(async () => {
		finish({
			success: true,
			data: { status: "recorded", replayed: false, account: account({ type: "report", id }) },
		});
	});
	expect(screen.queryByText(evidence)).toBeNull();
	expect(screen.queryByLabelText("Payment reference")).toBeNull();
	expect(edge.feedback).not.toHaveBeenCalled();
	expect(edge.writes).toHaveBeenCalledTimes(1);
});
