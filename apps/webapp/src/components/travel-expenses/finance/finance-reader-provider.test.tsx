/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Independent objection: an admitted queue must retire its account and selected
// action target once the actual organization provider observes no employee.
// Only browser transport, raw auth transport, routing and translation are seams.
const edge = vi.hoisted(() => ({
	actor: "reader-q",
	org: "org-q",
	employee: "employee-q" as string | null,
	role: "employee",
	pending: false,
	contextMode: "success",
	contextHolds: [] as ((r: Response) => void)[],
	holds: [] as { kind: string; resolve: (value: unknown) => void }[],
	extra: { exports: vi.fn(), payroll: vi.fn(), coverage: vi.fn() },
	mode: "success",
	reads: vi.fn(),
	filters: vi.fn(),
	writes: vi.fn(),
	contextReads: 0,
	exportCanSettle: false,
	reimbursementReads: vi.fn(),
	feedbackError: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, p?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (s, k) => String(p?.[k] ?? s)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));
vi.mock("sonner", () => ({ toast: { error: edge.feedbackError, success: vi.fn() } }));
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
			aria-label={name === "payday" ? "Payday" : "Payment date"}
			value={value}
			name={name}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
	Link: ({ children, ...props }: { children: ReactNode; href: string }) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: edge.pending,
		data: { user: { id: edge.actor }, session: { activeOrganizationId: edge.org } },
	}),
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-actions", () => ({
	getTravelExpenseFinanceQueue: edge.reads,
	getPayrollRunsToConfirmAction: edge.extra.payroll,
	getExpenseOfficerCoverageGap: edge.extra.coverage,
	confirmPayrollRunAction: edge.writes,
	getTravelExpenseFinanceQueueFilterOptions: edge.filters,
	markTravelExpensesReimbursedAction: edge.writes,
}));
vi.mock("@/app/[locale]/(app)/travel-expenses/finance-export-actions", () => ({
	getTravelExpenseExports: edge.extra.exports,
	createTravelExpenseExportAction: edge.writes,
	retryTravelExpenseExportAction: edge.writes,
	cancelTravelExpenseExportAction: edge.writes,
	getTravelExpenseExportReimbursement: edge.reimbursementReads,
	markTravelExpenseExportReimbursedAction: edge.writes,
}));

import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import { FinanceExports } from "@/components/travel-expenses/finance/finance-exports";
import { FinanceQueue } from "@/components/travel-expenses/finance/finance-queue";
import { OfficerCoverageGapNotice } from "@/components/travel-expenses/finance/officer-coverage-gap";
import { PayrollRunsToConfirm } from "@/components/travel-expenses/finance/payroll-runs-to-confirm";

const sourceId = "c93f8ca1-d0b0-444a-a072-d5a4dce5d78e";
const title = "SCOPE_LOSS_APPROVED_EXPENSE";
const account = {
	source: { type: "report", id: sourceId },
	organizationId: "org-q",
	employeeId: "employee-other",
	employeeName: "Synthetic Beneficiary",
	approved: true,
	currency: "EUR",
	basis: {
		evidence: "frozen_revision",
		revisionId: "revision-q",
		submissionCycle: 1,
		approvedAt: "2026-10-02T09:00:00Z",
		companyPaid: "0.00",
		approvalBasis: null,
	},
	entitlement: [
		{ kind: "approved_submission", id: "revision-q", currency: "EUR", amount: "48.00" },
	],
	entries: [],
	summary: {
		state: "outstanding",
		currencies: [
			{
				currency: "EUR",
				entitlement: "48.00",
				reimbursed: "0.00",
				recovered: "0.00",
				balance: "48.00",
				state: "outstanding",
			},
		],
	},
	title: { kind: "trip", purpose: title, startDate: null, endDate: null },
	adjustments: [],
	adjustmentOf: null,
	adjustmentDelta: null,
	payrollRun: null,
	confirmedPayrollRuns: [],
};
const clients: QueryClient[] = [];
function ObservedProvider() {
	const p = useOrganization();
	return (
		<>
			<output aria-label="Actual provider employee">{p.employeeId ?? "none"}</output>
			<output aria-label="Actual provider role">{p.role ?? "none"}</output>
		</>
	);
}
function mount(kind: Kind = "queue") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
	});
	clients.push(client);
	const initialContext = {
		userId: edge.actor,
		organizationId: edge.org,
		employee: edge.employee
			? { employeeId: edge.employee, organizationId: edge.org, role: "employee" as const }
			: null,
		organizationSettings: null,
		updatedAt: Date.now(),
	};
	const content =
		kind === "queue" ? (
			<FinanceQueue />
		) : kind === "exports" ? (
			<FinanceExports />
		) : kind === "payroll" ? (
			<PayrollRunsToConfirm />
		) : (
			<OfficerCoverageGapNotice />
		);
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={initialContext}>
				<ObservedProvider />
				<Activity mode={mode}>{content}</Activity>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(tree());
	return {
		client,
		rerender: () => view.rerender(tree()),
		show: (mode: "visible" | "hidden") => view.rerender(tree(mode)),
	};
}
beforeEach(() => {
	edge.actor = "reader-q";
	edge.org = "org-q";
	edge.employee = "employee-q";
	edge.mode = "success";
	edge.contextReads = 0;
	edge.exportCanSettle = false;
	edge.reimbursementReads.mockReset();
	edge.feedbackError.mockReset();
	Object.assign(batch, { status: "completed", retryable: false });
	edge.role = "employee";
	edge.pending = false;
	edge.contextMode = "success";
	edge.contextHolds = [];
	edge.holds = [];
	for (const fn of Object.values(edge.extra)) fn.mockReset();
	edge.extra.exports.mockImplementation(() => read("exports"));
	edge.extra.payroll.mockImplementation(() => read("payroll"));
	edge.extra.coverage.mockImplementation(() => read("coverage"));
	edge.reads.mockReset().mockImplementation(() => read("queue"));
	edge.filters
		.mockReset()
		.mockResolvedValue({ success: true, data: { employees: [], teams: [], currencies: ["EUR"] } });
	edge.writes.mockReset();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url !== "/api/auth/context") throw Error("Unexpected external transport");
			edge.contextReads++;
			if (edge.contextMode === "held")
				return await new Promise<Response>((resolve) => edge.contextHolds.push(resolve));
			if (edge.contextMode === "outage")
				return Response.json({ error: "Synthetic context outage" }, { status: 503 });
			return contextResponse();
		}),
	);
});
afterEach(() => {
	cleanup();
	for (const c of clients.splice(0)) c.clear();
	vi.unstubAllGlobals();
});
async function selectLoaded() {
	await screen.findByRole("link", { name: new RegExp(title) });
	fireEvent.click(
		screen.getByRole("checkbox", {
			name: "Select all expenses awaiting reimbursement on this page",
		}),
	);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Mark as reimbursed" })).toHaveProperty(
			"disabled",
			false,
		),
	);
}
async function loseEmployee(client: QueryClient) {
	edge.employee = null;
	edge.mode = "refusal";
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["organization-context"] });
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Actual provider employee")).toHaveProperty("textContent", "none"),
	);
}
it("control unchanged provider employee preserves the loaded account and its page selection", async () => {
	const v = mount();
	await selectLoaded();
	await act(async () => {
		await v.client.invalidateQueries({ queryKey: ["organization-context"] });
	});
	await waitFor(() => expect(edge.contextReads).toBe(1));
	expect(screen.getByLabelText("Actual provider employee")).toHaveProperty(
		"textContent",
		"employee-q",
	);
	expect(screen.getByRole("link", { name: new RegExp(title) }).getAttribute("href")).toBe(
		`/travel-expenses/reports/${sourceId}`,
	);
	expect(screen.getByRole("button", { name: "Mark as reimbursed" })).toHaveProperty(
		"disabled",
		false,
	);
	expect(edge.reads).toHaveBeenCalledTimes(1);
	expect(edge.writes).not.toHaveBeenCalled();
});
it("control raw organization replacement retires the old account before a held fresh queue read completes", async () => {
	const v = mount();
	await selectLoaded();
	edge.org = "org-new";
	edge.mode = "held";
	v.rerender();
	await waitFor(() => expect(edge.reads).toHaveBeenCalledTimes(2));
	expect(screen.queryByRole("link", { name: new RegExp(title) })).toBeNull();
	expect(screen.queryByRole("button", { name: "Mark as reimbursed" })).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});
it("PRIORITY current real-provider queue withdraws old account and selected reimbursement target on observed employee loss", async () => {
	const v = mount();
	await selectLoaded();
	await loseEmployee(v.client);
	expect(edge.writes).not.toHaveBeenCalled();
	expect(
		screen.queryByRole("link", { name: new RegExp(title) }),
		"Employee-less actual provider cannot leave an old finance account current",
	).toBeNull();
	expect(screen.queryByRole("button", { name: "Mark as reimbursed" })).toBeNull();
});

type Kind = "queue" | "exports" | "payroll" | "coverage";
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
const batch = {
	id: "batch-q",
	status: "completed",
	attempt: 1,
	revisionCount: 1,
	itemCount: 1,
	receiptCount: 0,
	totals: [{ currency: "EUR", reimbursable: "48.00", companyPaid: "0.00" }],
	manifestDigest: "synthetic",
	requestedAt: "2026-10-01T12:00:00Z",
	requestedByName: "Synthetic Finance",
	startedAt: "2026-10-01T12:00:01Z",
	completedAt: "2026-10-01T12:00:02Z",
	failedAt: null,
	errorCode: null,
	cancelledAt: null,
	cancelReason: null,
	fileName: "synthetic-finance.zip",
	sizeBytes: 128,
	checksumSha256: "f".repeat(64),
	retryable: false,
	cancellable: false,
	reports: [],
};
const run = {
	jobId: "run-q",
	formatId: "datev",
	formatName: "SCOPE_PRIVATE_PAYROLL_FORMAT",
	periodStart: "2026-10-01",
	periodEnd: "2026-10-31",
	defaultPayday: "2026-10-31",
	confirmableReports: 1,
	confirmableAmount: "48.00",
};
function success(kind: Kind) {
	return {
		success: true,
		data:
			kind === "queue"
				? { accounts: [account], page: 1, hasMore: false, canSettle: true }
				: kind === "exports"
					? { exportable: [], batches: [batch], maxRevisions: 100, canSettle: edge.exportCanSettle }
					: kind === "payroll"
						? [run]
						: { uncovered: 3 },
	};
}
async function read(kind: Kind): Promise<unknown> {
	if (edge.mode === "held")
		return await new Promise((resolve) => edge.holds.push({ kind, resolve }));
	if (edge.mode === "refusal")
		return kind === "coverage"
			? { success: true, data: null }
			: { success: false, error: "Unauthorized" };
	if (edge.mode === "outage") return { success: false, error: "Synthetic read unavailable" };
	return success(kind);
}
function evidence(kind: Kind) {
	return kind === "queue"
		? screen.queryByRole("link", { name: new RegExp(title) })
		: kind === "exports"
			? screen.queryByRole("link", { name: "Download", exact: true })
			: kind === "payroll"
				? screen.queryByText(run.formatName)
				: screen.queryByRole("link", { name: "Show these expenses" });
}
async function refreshed(client: QueryClient) {
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["organization-context"] });
	});
}
for (const kind of ["queue", "exports", "payroll", "coverage"] as const) {
	it(`${kind}: actual role replacement requires a fresh read before evidence returns`, async () => {
		const v = mount(kind);
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		edge.role = "manager";
		edge.mode = "held";
		await refreshed(v.client);
		await waitFor(() =>
			expect(screen.getByLabelText("Actual provider role")).toHaveProperty(
				"textContent",
				"manager",
			),
		);
		await waitFor(() => expect(edge.holds.filter((h) => h.kind === kind)).toHaveLength(1));
		expect(evidence(kind)).toBeNull();
		await act(async () => {
			edge.holds.find((h) => h.kind === kind)?.resolve(success(kind));
		});
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		expect(edge.writes).not.toHaveBeenCalled();
	});
	it(`${kind}: observed employee loss retires evidence and returning proof cannot reuse the old read`, async () => {
		const v = mount(kind);
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		edge.employee = null;
		edge.mode = "held";
		await refreshed(v.client);
		await waitFor(() =>
			expect(screen.getByLabelText("Actual provider employee")).toHaveProperty(
				"textContent",
				"none",
			),
		);
		expect(evidence(kind)).toBeNull();
		if (kind !== "coverage") expect(edge.holds.filter((h) => h.kind === kind)).toHaveLength(0);
		edge.employee = "employee-q";
		await refreshed(v.client);
		await waitFor(() =>
			expect(screen.getByLabelText("Actual provider employee")).toHaveProperty(
				"textContent",
				"employee-q",
			),
		);
		await waitFor(() =>
			expect(edge.holds.filter((h) => h.kind === kind)).toHaveLength(kind === "coverage" ? 2 : 1),
		);
		expect(evidence(kind)).toBeNull();
		const held = edge.holds.filter((h) => h.kind === kind);
		if (kind === "coverage") {
			await act(async () => {
				held[0].resolve(success(kind));
			});
			expect(evidence(kind)).toBeNull();
		}
		await act(async () => {
			held.at(-1)?.resolve(success(kind));
		});
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		expect(edge.writes).not.toHaveBeenCalled();
	});
	it(`${kind}: context failure has a serialized local Retry and never shows retained targets`, async () => {
		const v = mount(kind);
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		edge.contextMode = "outage";
		await refreshed(v.client);
		await screen.findByRole("button", { name: "Retry", exact: true });
		expect(evidence(kind)).toBeNull();
		edge.contextMode = "held";
		const before = edge.contextReads;
		fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
		await waitFor(() => expect(edge.contextHolds).toHaveLength(1));
		expect(screen.getByRole("button", { name: "Retry", exact: true })).toHaveProperty(
			"disabled",
			true,
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
		expect(edge.contextReads - before).toBe(1);
		edge.mode = "held";
		await act(async () => {
			edge.contextHolds[0](contextResponse());
		});
		await waitFor(() => expect(edge.holds.filter((h) => h.kind === kind)).toHaveLength(1));
		expect(evidence(kind)).toBeNull();
		await act(async () => {
			edge.holds.find((h) => h.kind === kind)?.resolve(success(kind));
		});
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		expect(edge.writes).not.toHaveBeenCalled();
	});
	it(`${kind}: authoritative read refusal remains withdrawn through a later outage`, async () => {
		const v = mount(kind);
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		edge.mode = "refusal";
		await act(async () => {
			await v.client.invalidateQueries({ queryKey: ["travel-expenses"] });
		});
		await waitFor(() => expect(evidence(kind)).toBeNull());
		edge.mode = "outage";
		await act(async () => {
			await v.client.invalidateQueries({ queryKey: ["travel-expenses"] });
		});
		await screen.findByRole("button", { name: "Retry", exact: true });
		expect(evidence(kind)).toBeNull();
		edge.mode = "success";
		fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
		await waitFor(() => expect(evidence(kind)).not.toBeNull());
		expect(edge.writes).not.toHaveBeenCalled();
	});
}
it("coverage: canonical administrator view remains available without an employee profile", async () => {
	edge.employee = null;
	mount("coverage");
	await waitFor(() => expect(evidence("coverage")).not.toBeNull());
	expect(screen.getByLabelText("Actual provider employee")).toHaveProperty("textContent", "none");
	expect(edge.extra.coverage).toHaveBeenCalledTimes(1);
	expect(edge.writes).not.toHaveBeenCalled();
});

it("queue: canonical withdrawal closes a selected bulk dialog and fresh success cannot restore its old targets", async () => {
	const v = mount();
	await selectLoaded();
	fireEvent.click(screen.getByRole("button", { name: "Mark as reimbursed", exact: true }));
	await screen.findByRole("dialog");
	edge.mode = "refusal";
	await act(async () => {
		await v.client.invalidateQueries({ queryKey: ["travel-expenses"] });
	});
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(evidence("queue")).toBeNull();
	edge.mode = "success";
	await act(async () => {
		await v.client.invalidateQueries({ queryKey: ["travel-expenses"] });
	});
	await waitFor(() => expect(evidence("queue")).not.toBeNull());
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(screen.getByRole("button", { name: "Mark as reimbursed", exact: true })).toHaveProperty(
		"disabled",
		true,
	);
	expect(edge.writes).not.toHaveBeenCalled();
});
for (const change of ["role", "employee-return", "Activity"] as const) {
	it(`payroll: unresolved confirmation stays reserved through ${change} before a second activation`, async () => {
		let finish = (_value: unknown) => {
			throw new Error("Confirmation not started");
		};
		edge.writes
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue({ success: false, error: "Synthetic command refusal" });
		const v = mount("payroll");
		await waitFor(() => expect(evidence("payroll")).not.toBeNull());
		fireEvent.click(screen.getByRole("button", { name: "Confirm as paid", exact: true }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Confirm as paid", exact: true }));
		await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(1));
		try {
			if (change === "role") {
				edge.role = "manager";
				await refreshed(v.client);
				await waitFor(() =>
					expect(screen.getByLabelText("Actual provider role")).toHaveProperty(
						"textContent",
						"manager",
					),
				);
			} else if (change === "employee-return") {
				edge.employee = null;
				await refreshed(v.client);
				await waitFor(() =>
					expect(screen.getByLabelText("Actual provider employee")).toHaveProperty(
						"textContent",
						"none",
					),
				);
				edge.employee = "employee-q";
				await refreshed(v.client);
				await waitFor(() =>
					expect(screen.getByLabelText("Actual provider employee")).toHaveProperty(
						"textContent",
						"employee-q",
					),
				);
			} else {
				v.show("hidden");
				v.show("visible");
			}
			await waitFor(() => expect(evidence("payroll")).not.toBeNull());
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			const trigger = screen.getByRole("button", { name: "Confirm as paid", exact: true });
			fireEvent.click(trigger);
			if (!trigger.hasAttribute("disabled")) {
				const returned = await screen.findByRole("dialog");
				fireEvent.click(
					within(returned).getByRole("button", { name: "Confirm as paid", exact: true }),
				);
				await screen.findByText(
					"The payroll run could not be confirmed. Please retry; nothing is recorded twice.",
				);
			}
			expect(edge.writes).toHaveBeenCalledTimes(1);
		} finally {
			await act(async () => {
				finish({ success: false, error: "Synthetic settled refusal" });
			});
		}
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Confirm as paid", exact: true })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect(
			screen.queryByText(
				"The payroll run could not be confirmed. Please retry; nothing is recorded twice.",
			),
		).toBeNull();
	});
}

it("exports: a pending batch retry stays reserved across provider replacement and drops retired feedback", async () => {
	Object.assign(batch, { status: "failed", retryable: true });
	let finish = (_value: unknown) => {
		throw new Error("Retry not started");
	};
	edge.writes
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		)
		.mockResolvedValue({ success: false, error: "Synthetic refusal" });
	const v = mount("exports");
	const first = await screen.findByRole("button", { name: "Retry", exact: true });
	fireEvent.click(first);
	await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(1));
	try {
		edge.role = "manager";
		await refreshed(v.client);
		await waitFor(() =>
			expect(screen.getByLabelText("Actual provider role")).toHaveProperty(
				"textContent",
				"manager",
			),
		);
		await waitFor(() => expect(first.isConnected).toBe(false));
		const current = await screen.findByRole("button", { name: "Retry", exact: true });
		fireEvent.click(current);
		if (!current.hasAttribute("disabled"))
			await waitFor(() => expect(edge.writes).toHaveBeenCalledTimes(2));
		expect(edge.writes).toHaveBeenCalledTimes(1);
	} finally {
		await act(async () => {
			finish({ success: false, error: "Synthetic retired refusal" });
		});
	}
	expect(edge.feedbackError).not.toHaveBeenCalled();
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Retry", exact: true })).toHaveProperty(
			"disabled",
			false,
		),
	);
});
it("exports: a reimbursement read retired by provider replacement cannot emit late failure feedback", async () => {
	edge.exportCanSettle = true;
	let finish = (_value: unknown) => {
		throw new Error("Read not started");
	};
	edge.reimbursementReads.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const v = mount("exports");
	const first = await screen.findByRole("button", { name: "Mark as reimbursed", exact: true });
	fireEvent.click(first);
	await waitFor(() => expect(edge.reimbursementReads).toHaveBeenCalledTimes(1));
	edge.role = "manager";
	await refreshed(v.client);
	await waitFor(() =>
		expect(screen.getByLabelText("Actual provider role")).toHaveProperty("textContent", "manager"),
	);
	await waitFor(() => expect(first.isConnected).toBe(false));
	await screen.findByRole("button", { name: "Mark as reimbursed", exact: true });
	await act(async () => {
		finish({ success: false, error: "Synthetic retired read refusal" });
	});
	expect(edge.feedbackError).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(edge.writes).not.toHaveBeenCalled();
});
