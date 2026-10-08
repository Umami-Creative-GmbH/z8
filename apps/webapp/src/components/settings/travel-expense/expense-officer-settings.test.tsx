// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	getExpenseOfficerAdminData: vi.fn(),
	saveExpenseOfficerGrantAction: vi.fn(),
	revokeExpenseOfficerGrantAction: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/expense-officer-actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		label,
		value,
		onChange,
		excludeIds = [],
		employees = [],
		disabled,
	}: {
		label?: string;
		value: string | null;
		onChange: (value: string | null) => void;
		excludeIds?: string[];
		employees?: Array<{ id: string; user: { name: string | null } }>;
		disabled?: boolean;
	}) => (
		<select
			aria-label={label}
			value={value ?? ""}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value || null)}
		>
			<option value="">Select employee</option>
			{employees
				.filter((employee) => !excludeIds.includes(employee.id))
				.map((employee) => (
					<option key={employee.id} value={employee.id}>
						{employee.user.name}
					</option>
				))}
		</select>
	),
	EmployeeMultiSelect: ({
		label,
		value,
		onChange,
		employees = [],
	}: {
		label?: string;
		value: string[];
		onChange: (value: string[]) => void;
		employees?: Array<{ id: string; isActive: boolean; user: { name: string | null } }>;
	}) => (
		<fieldset>
			<legend>{label}</legend>
			{employees.map((employee) => (
				<label key={employee.id}>
					<input
						type="checkbox"
						checked={value.includes(employee.id)}
						onChange={(event) =>
							onChange(
								event.target.checked
									? [...value, employee.id]
									: value.filter((id) => id !== employee.id),
							)
						}
					/>
					{employee.user.name}
					{employee.isActive ? "" : " (inactive)"}
				</label>
			))}
		</fieldset>
	),
}));

import { ExpenseOfficerSettingsCard } from "./expense-officer-settings";

const people = {
	employees: [
		{ id: "employee-ada", name: "Ada Lovelace", email: "ada@example.com" },
		{ id: "employee-grace", name: "Grace Hopper", email: "grace@example.com" },
	],
	departedEmployees: [{ id: "employee-gone", name: "Former Colleague", email: "f@example.com" }],
	teams: [{ id: "team-berlin", name: "Berlin" }],
};

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ExpenseOfficerSettingsCard />
		</QueryClientProvider>,
	);
}

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

beforeEach(() => {
	actions.saveExpenseOfficerGrantAction.mockResolvedValue({
		success: true,
		data: { grantId: "grant-1" },
	});
	actions.revokeExpenseOfficerGrantAction.mockResolvedValue({
		success: true,
		data: { grantId: "grant-1" },
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("expense officer settings (#747)", () => {
	it("lists officers with their scope and capabilities", async () => {
		actions.getExpenseOfficerAdminData.mockResolvedValue({
			success: true,
			data: {
				...people,
				grants: [
					{
						id: "grant-1",
						officerEmployeeId: "employee-ada",
						scope: "specific",
						teamIds: ["team-berlin"],
						employeeIds: [],
						canExport: true,
						canRecordReimbursements: false,
					},
				],
			},
		});
		mount();
		expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Reads and exports")).toBeTruthy();
	});

	it("names a departed employee, marked as such, and saves the capabilities", async () => {
		actions.getExpenseOfficerAdminData.mockResolvedValue({
			success: true,
			data: { ...people, grants: [] },
		});
		const user = userEvent.setup();
		mount();
		await user.click(await screen.findByRole("button", { name: "Add expense officer" }));
		await user.selectOptions(screen.getByLabelText("Expense officer"), "employee-grace");
		await user.click(screen.getByRole("switch", { name: "Berlin" }));
		await user.click(screen.getByRole("checkbox", { name: "Former Colleague (inactive)" }));
		expect(
			screen.getByText(
				"Former Colleague left the organization. Their approved reports stay with this officer.",
			),
		).toBeTruthy();
		await user.click(screen.getByRole("checkbox", { name: "Can record reimbursements" }));
		await user.click(screen.getByRole("button", { name: "Save expense officer" }));

		await waitFor(() =>
			expect(actions.saveExpenseOfficerGrantAction).toHaveBeenCalledWith({
				officerEmployeeId: "employee-grace",
				scope: "specific",
				teamIds: ["team-berlin"],
				employeeIds: ["employee-gone"],
				canExport: false,
				canRecordReimbursements: true,
			}),
		);
	});

	it("re-saves an unchanged grant that names a departed employee", async () => {
		const grant = {
			id: "grant-1",
			officerEmployeeId: "employee-ada",
			scope: "specific" as const,
			teamIds: [],
			employeeIds: ["employee-gone"],
			canExport: false,
			canRecordReimbursements: false,
		};
		actions.getExpenseOfficerAdminData.mockResolvedValue({
			success: true,
			data: { ...people, grants: [grant] },
		});
		const user = userEvent.setup();
		mount();
		await user.click(await screen.findByRole("button", { name: "Edit" }));
		expect(screen.getByText("Read only")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Save expense officer" }));
		await waitFor(() =>
			expect(actions.saveExpenseOfficerGrantAction).toHaveBeenCalledWith({
				officerEmployeeId: "employee-ada",
				scope: "specific",
				teamIds: [],
				employeeIds: ["employee-gone"],
				canExport: false,
				canRecordReimbursements: false,
			}),
		);
	});

	it("revokes an officer after confirmation", async () => {
		actions.getExpenseOfficerAdminData.mockResolvedValue({
			success: true,
			data: {
				...people,
				grants: [
					{
						id: "grant-1",
						officerEmployeeId: "employee-ada",
						scope: "all",
						teamIds: [],
						employeeIds: [],
						canExport: true,
						canRecordReimbursements: true,
					},
				],
			},
		});
		const user = userEvent.setup();
		mount();
		await user.click(await screen.findByRole("button", { name: "Revoke" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(dialog.textContent).toContain("Ada Lovelace");
		await user.click(screen.getByRole("button", { name: "Revoke access" }));
		await waitFor(() =>
			expect(actions.revokeExpenseOfficerGrantAction).toHaveBeenCalledWith({ grantId: "grant-1" }),
		);
	});
});
