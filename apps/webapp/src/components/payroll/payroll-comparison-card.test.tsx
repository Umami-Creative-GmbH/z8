// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollComparisonCard } from "./payroll-comparison-card";

const actions = vi.hoisted(() => ({
	listCompatiblePayrollBaselinesAction: vi.fn(),
	preparePayrollComparisonAction: vi.fn(),
	inspectPayrollBaselineAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/payroll/comparison-actions", () => actions);
vi.mock("@/app/[locale]/(app)/payroll/baseline-actions", () => actions);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const baseline = {
	id: "baseline-a",
	jobId: "job-a",
	formatId: "datev_lohn" as const,
	destination: {
		configId: "config-a",
		mandantennummer: "12345",
		beraternummer: "67890",
	},
	period: { startDate: "2026-09-01", endDate: "2026-09-30" },
	employeeIds: ["employee-a", "employee-departed"],
	createdAt: "2026-09-30T10:00:00Z",
	completedAt: "2026-09-30T10:01:00Z",
	expiresAt: "2028-09-30T10:01:00Z",
	availability: "available" as const,
};
const filters = {
	dateRange: { start: "2026-09-01", end: "2026-09-30" },
	employeeIds: baseline.employeeIds,
};
function view(employeeIds?: string[]) {
	return (
		<PayrollComparisonCard
			startDate="2026-09-01"
			endDate="2026-09-30"
			employeeIds={employeeIds}
		/>
	);
}
function setup(employeeIds?: string[]) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(view(employeeIds), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	actions.listCompatiblePayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [baseline],
	});
	actions.inspectPayrollBaselineAction.mockImplementation(
		async (id: string) => ({
			success: true,
			data: { summary: { ...baseline, id }, evidence: { filters } },
		}),
	);
});
describe("Payroll workspace DATEV comparison", () => {
	it("shows the latest eligible baseline and full scope before preparing a comparison", async () => {
		actions.listCompatiblePayrollBaselinesAction.mockResolvedValue({
			success: true,
			data: [
				{
					...baseline,
					id: "unavailable-newer",
					availability: "expired",
					completedAt: "2026-10-01T10:00:00Z",
				},
				baseline,
				{ ...baseline, id: "baseline-z" },
			],
		});
		setup();
		await screen.findByText("baseline-z", { selector: "dd" });
		expect(screen.getByText("12345 / 67890")).toBeTruthy();
		expect(
			screen.getByText("employee-departed", { selector: "li" }),
		).toBeTruthy();
		expect(screen.getByText("2026-09-30 10:01:00 UTC")).toBeTruthy();
		expect(
			screen.getByText(/Expense reimbursements are excluded/),
		).toBeTruthy();
		expect(await screen.findByText("Effective baseline filters")).toBeTruthy();
		expect(actions.preparePayrollComparisonAction).not.toHaveBeenCalled();
		expect(
			(
				await screen.findByRole("button", { name: "Prepare comparison" })
			).hasAttribute("disabled"),
		).toBe(false);
	});
});

const oldRow = {
	personnelNumber: "OLD-42",
	wageTypeCode: "100",
	date: "2026-09-03",
	quantity: "8.00",
	unit: "hours" as const,
	note: "Original source note",
	contributions: [
		{
			kind: "overtime_payout" as const,
			sourceId: "payout-old",
			sourceRevision: null,
			sourceActorId: "payroll-actor",
			employeeId: "employee-a",
			firstName: "Ada",
			lastName: "Lovelace",
			hours: 8,
			reason: "Original request note",
			facts: { day: "2026-09-03", minutes: 480, mappingId: "mapping-a" },
		},
	],
};
const newRow = {
	...oldRow,
	quantity: "9.00",
	note: "Current source note",
	contributions: [
		{ ...oldRow.contributions[0], sourceId: "payout-new", hours: 9 },
	],
};
const reviewed = {
	id: "reviewed-a",
	baseline,
	filters,
	preparedAt: "2026-10-18T09:10:00Z",
	expiresAt: "2026-10-19T09:10:00Z",
	comparison: {
		version: 1 as const,
		formatId: "datev_lohn" as const,
		formatterVersions: { old: "2024.1", new: "2024.1" },
		excludedLineKinds: ["expense"],
		hasPayrollImpact: true,
		rows: [
			{
				key: "row-a",
				status: "changed" as const,
				employeeIds: ["employee-a"],
				oldRow,
				newRow,
				delta: "+1.00",
				changedFields: ["quantity", "note"],
			},
		],
		employees: [
			{
				employeeId: "employee-a",
				firstName: "Ada",
				lastName: "Lovelace",
				status: "changed" as const,
				oldPersonnelNumbers: ["OLD-42"],
				newPersonnelNumbers: ["OLD-42"],
				rowKeys: ["row-a"],
				totals: [],
			},
		],
		totals: [
			{
				wageTypeCode: "100",
				unit: "hours",
				oldQuantity: "8.00",
				newQuantity: "9.00",
				delta: "+1.00",
				hasPayrollImpact: true,
			},
		],
		sourceOnlyChanges: [],
		summary: {
			addedRows: 0,
			removedRows: 0,
			changedRows: 1,
			addedEmployees: 0,
			removedEmployees: 0,
			changedEmployees: 1,
			sourceOnlyEmployees: 0,
		},
	},
};
it("prepares once and downloads the exact reviewed result with before/current output and source context", async () => {
	actions.preparePayrollComparisonAction.mockResolvedValue({
		success: true,
		data: { status: "ready", result: reviewed },
	});
	setup();
	fireEvent.click(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	);
	await screen.findByText("2026-10-18 09:10:00 UTC");
	const row = within(
		screen.getByRole("table", { name: "Changed DATEV output rows" }),
	)
		.getByText("9.00")
		.closest("tr");
	if (!row) throw new Error("Change row not found");
	expect(within(row).getByText("8.00")).toBeTruthy();
	expect(within(row).getByText("+1.00")).toBeTruthy();
	expect(within(row).getByText("Original source note")).toBeTruthy();
	expect(within(row).getByText("Current source note")).toBeTruthy();
	fireEvent.click(within(row).getByText("Source contributions"));
	await waitFor(() =>
		expect(within(row).getAllByText("payroll-actor").length).toBe(2),
	);
	expect(within(row).getAllByText("Original request note").length).toBe(2);
	expect(within(row).getByText(/Original source notes describe/)).toBeTruthy();
	expect(
		screen
			.getByRole("link", { name: "Download reviewed comparison (CSV)" })
			.getAttribute("href"),
	).toBe("/api/payroll/comparisons/reviewed-a");
	expect(actions.preparePayrollComparisonAction).toHaveBeenCalledTimes(1);
	expect(actions.preparePayrollComparisonAction).toHaveBeenCalledWith({
		baselineId: baseline.id,
		startDate: "2026-09-01",
		endDate: "2026-09-30",
	});
	expect(
		screen.getByRole("button", { name: "Refresh comparison" }),
	).toBeTruthy();
});

it.each([
	[
		{
			status: "blocked",
			blockers: [
				{ employeeId: "employee-a", reason: "missing_personnel_identifier" },
			],
		},
		"Current payroll data is blocked. Resolve these issues and prepare the comparison again.",
	],
	[
		{ status: "incompatible", reason: "employee_scope_changed" },
		"The selected baseline is incompatible with the current payroll scope. Select a compatible baseline or restore the original period, employees and destination.",
	],
	[
		{ status: "unavailable" },
		"This baseline is no longer available for comparison.",
	],
])(
	"does not offer a misleading result or download when preparation is %j",
	async (preparation, message) => {
		actions.preparePayrollComparisonAction.mockResolvedValue({
			success: true,
			data: preparation,
		});
		setup();
		fireEvent.click(
			await screen.findByRole("button", { name: "Prepare comparison" }),
		);
		expect(await screen.findByText(message)).toBeTruthy();
		expect(
			screen.queryByRole("link", {
				name: "Download reviewed comparison (CSV)",
			}),
		).toBeNull();
		if (preparation.status === "blocked")
			expect(
				screen.getByText(
					"Missing personnel identifier. Update the employee’s payroll identifier.",
				),
			).toBeTruthy();
	},
);

it("separates source-only changes from supported payroll impact, including empty baselines", async () => {
	actions.listCompatiblePayrollBaselinesAction.mockResolvedValue({
		success: true,
		data: [{ ...baseline, availability: "empty" }],
	});
	actions.preparePayrollComparisonAction.mockResolvedValue({
		success: true,
		data: {
			status: "ready",
			result: {
				...reviewed,
				comparison: {
					...reviewed.comparison,
					hasPayrollImpact: false,
					rows: [],
					totals: [],
					employees: [],
					sourceOnlyChanges: [
						{
							key: "source-only",
							employeeIds: ["employee-a"],
							oldRow,
							newRow: { ...oldRow, contributions: newRow.contributions },
							outputImpact: "none",
						},
					],
					summary: {
						...reviewed.comparison.summary,
						changedRows: 0,
						changedEmployees: 0,
						sourceOnlyEmployees: 1,
					},
				},
			},
		},
	});
	setup();
	expect(
		await screen.findByText(
			"This is a valid empty baseline: the successful export contained no supported payroll rows.",
		),
	).toBeTruthy();
	fireEvent.click(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	);
	expect(
		await screen.findByText("No supported payroll changes found."),
	).toBeTruthy();
	expect(
		screen.getByText("Source changes only; no payroll output impact"),
	).toBeTruthy();
	expect(
		screen.queryByRole("table", { name: "Changed DATEV output rows" }),
	).toBeNull();
});

it("keeps reviewed data stable until an explicit refresh and discards a response after the employee selection changes", async () => {
	actions.preparePayrollComparisonAction.mockResolvedValueOnce({
		success: true,
		data: { status: "ready", result: reviewed },
	});
	let completeRefresh!: (response: unknown) => void;
	actions.preparePayrollComparisonAction.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				completeRefresh = resolve;
			}),
	);
	const { rerender } = setup();
	fireEvent.click(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	);
	await screen.findByRole("link", {
		name: "Download reviewed comparison (CSV)",
	});
	rerender(view());
	expect(
		screen
			.getByRole("link", { name: "Download reviewed comparison (CSV)" })
			.getAttribute("href"),
	).toBe("/api/payroll/comparisons/reviewed-a");
	expect(actions.preparePayrollComparisonAction).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Refresh comparison" }));
	await waitFor(() =>
		expect(actions.preparePayrollComparisonAction).toHaveBeenCalledTimes(2),
	);
	rerender(view(["employee-new"]));
	await screen.findByRole("button", { name: "Prepare comparison" });
	await act(async () => {
		completeRefresh({
			success: true,
			data: { status: "ready", result: { ...reviewed, id: "stale-response" } },
		});
	});
	expect(
		screen.queryByRole("link", { name: "Download reviewed comparison (CSV)" }),
	).toBeNull();
	expect(screen.queryByText("stale-response")).toBeNull();
	expect(actions.listCompatiblePayrollBaselinesAction).toHaveBeenLastCalledWith(
		{
			startDate: "2026-09-01",
			endDate: "2026-09-30",
			employeeIds: ["employee-new"],
		},
	);
});

it("shows available recorded change explanations separately from original source notes", async () => {
	actions.preparePayrollComparisonAction.mockResolvedValue({
		success: true,
		data: {
			status: "ready",
			result: {
				...reviewed,
				explanations: [
					{
						kind: "overtime_payout",
						sourceId: "payout-old",
						employeeId: "employee-a",
						action: "cancelled",
						actorId: "change-actor",
						reason: "Payroll manager cancelled this payout",
					},
				],
			},
		},
	});
	setup();
	fireEvent.click(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	);
	expect(await screen.findByText("Recorded change events")).toBeTruthy();
	expect(
		screen.getByText("Payroll manager cancelled this payout"),
	).toBeTruthy();
	expect(screen.getByText("change-actor")).toBeTruthy();
});

it("lets the preparer retry when no compatible baseline is available", async () => {
	actions.listCompatiblePayrollBaselinesAction
		.mockResolvedValueOnce({ success: true, data: [] })
		.mockResolvedValueOnce({ success: true, data: [baseline] });
	setup();
	expect(
		await screen.findByText(
			"No compatible DATEV baseline is available for this period and employee selection.",
		),
	).toBeTruthy();
	fireEvent.click(
		screen.getByRole("button", { name: "Refresh compatible baselines" }),
	);
	expect(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	).toBeTruthy();
});

it("mounts source details only on expansion and bounds each side to 50 contributions", async () => {
	const contributions = Array.from({ length: 51 }, (_, index) => ({
		...oldRow.contributions[0],
		sourceId: `bounded-source-${index}`,
	}));
	actions.preparePayrollComparisonAction.mockResolvedValue({
		success: true,
		data: {
			status: "ready",
			result: {
				...reviewed,
				comparison: {
					...reviewed.comparison,
					rows: [
						{
							...reviewed.comparison.rows[0],
							oldRow: { ...oldRow, contributions },
							newRow: null,
						},
					],
				},
			},
		},
	});
	setup();
	fireEvent.click(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	);
	await screen.findByRole("table", { name: "Changed DATEV output rows" });
	expect(screen.queryByText("bounded-source-0")).toBeNull();
	fireEvent.click(
		screen.getByText("Source contributions", { selector: "summary" }),
	);
	expect(await screen.findByText("bounded-source-0")).toBeTruthy();
	expect(screen.queryByText("bounded-source-50")).toBeNull();
	const side = screen.getByRole("region", { name: "Baseline sources" });
	fireEvent.click(
		within(side).getByRole("button", { name: "Next source contributions" }),
	);
	expect(within(side).getByText("bounded-source-50")).toBeTruthy();
	expect(within(side).queryByText("bounded-source-0")).toBeNull();
});

it("shows retained employee names alongside the full baseline scope before preparing", async () => {
	actions.inspectPayrollBaselineAction.mockResolvedValue({
		success: true,
		data: {
			summary: baseline,
			evidence: { filters, output: { rows: [oldRow] } },
		},
	});
	setup();
	expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
	expect(
		screen.getByText("employee-departed", { selector: "li" }),
	).toBeTruthy();
	expect(actions.preparePayrollComparisonAction).not.toHaveBeenCalled();
});

it.each([
	[
		"pending_absence",
		"An absence is awaiting approval. Review the employee’s absences before preparing a complete comparison.",
	],
	[
		"pending_absence_change",
		"An absence change is awaiting approval. Review the employee’s absence changes before preparing a complete comparison.",
	],
])("explains the required approval for %s", async (reason, message) => {
	actions.preparePayrollComparisonAction.mockResolvedValue({
		success: true,
		data: {
			status: "blocked",
			blockers: [{ employeeId: "employee-a", reason }],
		},
	});
	setup();
	fireEvent.click(
		await screen.findByRole("button", { name: "Prepare comparison" }),
	);
	expect(await screen.findByText(message)).toBeTruthy();
});
