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
	createVacationPolicyAssignment,
	getVacationPolicies,
	getVacationPolicyHistoryContext,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
import { VacationAssignmentDialog } from "./vacation-assignment-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/holidays/preset-actions", () => ({
	getTeamsForAssignment: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/vacation/assignment-actions", () => ({
	createVacationPolicyAssignment: vi.fn(),
	getVacationPolicies: vi.fn(),
	getVacationPolicyHistoryContext: vi.fn(),
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
			baselineDate: "2026-10-17",
		},
	});
	vi.mocked(getVacationPolicies).mockResolvedValue({
		success: true,
		data: [
			{
				id: "policy-1",
				name: "Standard",
				startDate: "2026-01-01",
				validUntil: null,
				isCompanyDefault: false,
				defaultAnnualDays: "30",
				accrualType: "annual",
				allowCarryover: false,
				isActive: true,
			},
		],
	} as never);
	vi.mocked(createVacationPolicyAssignment).mockResolvedValue({
		success: true,
	} as never);
});
function renderDialog(
	assignmentType: "organization" | "employee" = "employee",
) {
	return render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<VacationAssignmentDialog
				open
				onOpenChange={vi.fn()}
				organizationId="org-1"
				assignmentType={assignmentType}
				onSuccess={vi.fn()}
			/>
		</QueryClientProvider>,
	);
}
describe("dated vacation assignments", () => {
	it("schedules a dated organization assignment without an employee or team target", async () => {
		const user = userEvent.setup();
		renderDialog("organization");
		await screen.findByLabelText("Effective from");
		expect(screen.queryByLabelText("Employee")).toBeNull();
		await user.click(screen.getByRole("combobox"));
		await user.click(await screen.findByRole("option", { name: /Standard/ }));
		await user.click(screen.getByRole("button", { name: "Assign" }));
		await waitFor(() =>
			expect(createVacationPolicyAssignment).toHaveBeenCalledWith(
				expect.objectContaining({
					assignmentType: "organization",
					effectiveFrom: "2026-10-17",
					teamId: undefined,
					employeeId: undefined,
				}),
			),
		);
	});
	it("uses the organization date and requires review before scheduling a historical replacement", async () => {
		const user = userEvent.setup();
		renderDialog();
		const start =
			await screen.findByLabelText<HTMLInputElement>("Effective from");
		expect(start.value).toBe("2026-10-17");
		expect(start.min).toBe("2026-01-01");
		await user.click(screen.getByRole("combobox"));
		await user.click(await screen.findByRole("option", { name: /Standard/ }));
		fireEvent.change(screen.getByLabelText("Employee"), {
			target: { value: "employee-1" },
		});
		fireEvent.change(start, { target: { value: "2026-07-01" } });
		await user.click(screen.getByRole("button", { name: "Assign" }));
		expect(
			await screen.findByText("Review and confirm this backdated assignment."),
		).toBeTruthy();
		expect(createVacationPolicyAssignment).not.toHaveBeenCalled();
		await user.click(screen.getByRole("checkbox", { name: /I reviewed/ }));
		fireEvent.change(screen.getByLabelText("End date (optional)"), {
			target: { value: "2027-01-01" },
		});
		await user.click(screen.getByRole("button", { name: "Assign" }));
		await waitFor(() =>
			expect(createVacationPolicyAssignment).toHaveBeenCalledWith({
				policyId: "policy-1",
				assignmentType: "employee",
				employeeId: "employee-1",
				teamId: undefined,
				effectiveFrom: "2026-07-01",
				effectiveUntil: "2027-01-01",
				reviewedBackdate: true,
			}),
		);
	});
});
