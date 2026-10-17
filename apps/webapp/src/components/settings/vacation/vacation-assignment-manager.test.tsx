/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	deleteVacationPolicyAssignment,
	getCompanyDefaultPolicies,
	getVacationPolicyAssignments,
	getVacationPolicyHistoryContext,
	previewEmployeeVacationPolicy,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
import { VacationAssignmentManager } from "./vacation-assignment-manager";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/vacation/assignment-actions", () => ({
	deleteVacationPolicyAssignment: vi.fn(),
	getCompanyDefaultPolicies: vi.fn(),
	getVacationPolicyAssignments: vi.fn(),
	getVacationPolicyHistoryContext: vi.fn(),
	previewEmployeeVacationPolicy: vi.fn(),
}));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		value,
		onChange,
		label,
	}: {
		value: string;
		onChange: (value: string) => void;
		label: string;
	}) => (
		<label>
			{label}
			<input
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value)}
			/>
		</label>
	),
}));
beforeAll(() => {
	global.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});
afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getVacationPolicyHistoryContext).mockResolvedValue({
		success: true,
		data: {
			today: "2026-10-17",
			timezone: "Europe/Berlin",
			baselineDate: "2026-01-01",
		},
	});
	vi.mocked(getCompanyDefaultPolicies).mockResolvedValue({
		success: true,
		data: { current: null, next: null },
	});
	vi.mocked(getVacationPolicyAssignments).mockResolvedValue({
		success: true,
		data: [],
	});
});
function renderManager(
	onAssignClick = vi.fn(),
	allowedAssignmentTypes: readonly ("team" | "employee")[] = [
		"team",
		"employee",
	],
) {
	return render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<VacationAssignmentManager
				organizationId="org-1"
				allowedAssignmentTypes={allowedAssignmentTypes}
				onAssignClick={onAssignClick}
			/>
		</QueryClientProvider>,
	);
}
describe("vacation history settings", () => {
	it("allows admins to schedule organization assignments without exposing that action to managers", async () => {
		const user = userEvent.setup();
		const onAssignClick = vi.fn();
		renderManager(onAssignClick);
		await user.click(
			await screen.findByRole("button", { name: "Assign Organization Policy" }),
		);
		expect(onAssignClick).toHaveBeenCalledWith("organization");
		cleanup();
		renderManager(vi.fn(), ["employee"]);
		await screen.findByLabelText("Preview date");
		expect(
			screen.queryByRole("button", { name: "Assign Organization Policy" }),
		).toBeNull();
	});
	it.each([
		{
			result: {
				status: "conflict",
				policyIds: [],
				reason: "incompatible_transition",
			},
			label: "Conflicting policies",
			detail:
				"Calculation method or joiner/leaver proration changes must take effect on 1 January. Review this assignment.",
		},
		{
			result: {
				status: "resolved",
				source: "team",
				policy: { name: "Engineering policy" },
			},
			label: "Engineering policy",
			detail: "Team assignment",
		},
		{
			result: { status: "missing" },
			label: "No policy for this date",
			detail: "Add a dated assignment or a company default covering this date.",
		},
		{
			result: { status: "legacy" },
			label: "Before dated policy history",
			detail:
				"Dated policy history for this organization starts after this date. Legacy policy rules apply.",
		},
	])(
		"shows $result.status explicitly in date preview",
		async ({ result, label, detail }) => {
			const user = userEvent.setup();
			vi.mocked(previewEmployeeVacationPolicy).mockResolvedValue({
				success: true,
				data: result,
			} as never);
			renderManager();
			await waitFor(() =>
				expect(
					screen.getByLabelText<HTMLInputElement>("Preview date").value,
				).toBe("2026-10-17"),
			);
			fireEvent.change(screen.getByLabelText("Preview employee"), {
				target: { value: "employee-1" },
			});
			await user.click(screen.getByRole("button", { name: "Preview policy" }));
			expect(await screen.findByText(label)).toBeTruthy();
			expect(screen.getByText(detail)).toBeTruthy();
			fireEvent.change(screen.getByLabelText("Preview date"), {
				target: { value: "2026-08-01" },
			});
			await waitFor(() => expect(screen.queryByText(label)).toBeNull());
		},
	);
	it("ends an assignment on a chosen future date while retaining its history", async () => {
		const user = userEvent.setup();
		vi.mocked(getVacationPolicyAssignments).mockResolvedValue({
			success: true,
			data: [
				{
					id: "assignment-1",
					policyId: "policy-1",
					assignmentType: "team",
					teamId: "team-1",
					employeeId: null,
					priority: 1,
					effectiveFrom: null,
					effectiveUntil: null,
					effectiveStartDate: "2026-01-01",
					effectiveEndDate: null,
					isActive: true,
					createdAt: new Date("2026-01-01T00:00:00Z"),
					policy: {
						id: "policy-1",
						name: "Standard",
						startDate: "2026-01-01",
						validUntil: null,
						defaultAnnualDays: "30",
						accrualType: "annual",
						allowCarryover: false,
						maxCarryoverDays: null,
						isCompanyDefault: false,
					},
					team: { id: "team-1", name: "Engineering" },
					employee: null,
				},
			],
		} as never);
		vi.mocked(deleteVacationPolicyAssignment).mockResolvedValue({
			success: true,
		} as never);
		const onAssignClick = vi.fn();
		renderManager(onAssignClick);
		await user.click(
			await screen.findByRole("button", {
				name: "Replace assignment: Engineering",
			}),
		);
		expect(onAssignClick).toHaveBeenCalledWith("team", "team-1");
		await user.click(
			screen.getByRole("button", { name: "End assignment: Engineering" }),
		);
		fireEvent.change(screen.getByLabelText("End assignment on"), {
			target: { value: "2027-01-01" },
		});
		await user.click(screen.getByRole("button", { name: "Save end date" }));
		await waitFor(() =>
			expect(deleteVacationPolicyAssignment).toHaveBeenCalledWith(
				"assignment-1",
				"2027-01-01",
			),
		);
	});
	it("previews an employee on the selected date and exposes conflicts without a fallback policy", async () => {
		const user = userEvent.setup();
		vi.mocked(previewEmployeeVacationPolicy).mockResolvedValue({
			success: true,
			data: { status: "conflict", policyIds: ["one", "two"] },
		});
		renderManager();
		const date = await screen.findByLabelText<HTMLInputElement>("Preview date");
		await waitFor(() => expect(date.value).toBe("2026-10-17"));
		fireEvent.change(screen.getByLabelText("Preview employee"), {
			target: { value: "employee-1" },
		});
		fireEvent.change(date, { target: { value: "2026-07-01" } });
		await user.click(screen.getByRole("button", { name: "Preview policy" }));
		expect(await screen.findByText("Conflicting policies")).toBeTruthy();
		expect(previewEmployeeVacationPolicy).toHaveBeenCalledWith(
			"employee-1",
			"2026-07-01",
		);
		expect(
			screen.getByText(
				"Resolve the overlapping assignments before this date can use a policy.",
			),
		).toBeTruthy();
	});
});
