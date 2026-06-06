// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollAccessForm } from "./payroll-access-form";

const { savePayrollAccessActionMock } = vi.hoisted(() => ({
	savePayrollAccessActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			let translated = fallback;
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/payroll-access/actions", () => ({
	savePayrollAccessAction: savePayrollAccessActionMock,
}));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		label,
		value,
		onChange,
		excludeIds = [],
		employees = [],
	}: {
		label?: string;
		value: string | null;
		onChange: (value: string | null) => void;
		excludeIds?: string[];
		employees?: Array<{ id: string; user: { name: string | null; email: string } }>;
	}) => (
		<label>
			{label}
			<select
				aria-label={label}
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value || null)}
			>
				<option value="">Select employee</option>
				{employees
					.filter((employee) => !excludeIds.includes(employee.id))
					.map((employee) => (
						<option key={employee.id} value={employee.id}>
							{employee.user.name ?? employee.user.email}
						</option>
					))}
			</select>
		</label>
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
		employees?: Array<{ id: string; user: { name: string | null; email: string } }>;
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
					{employee.user.name ?? employee.user.email}
				</label>
			))}
		</fieldset>
	),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("PayrollAccessForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		savePayrollAccessActionMock.mockResolvedValue({ success: true, data: { grantId: "grant-id" } });
	});

	it("renders the payroll officer list empty state", () => {
		render(
			<PayrollAccessForm
				employees={[{ id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" }]}
				teams={[{ id: "team-1", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		expect(screen.queryByText("Payroll Officers")).toBeNull();
		expect(
			screen.queryByText(
				"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
			),
		).toBeNull();
		expect(screen.getByText("No payroll officers have been added yet.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add payroll officer" })).toBeTruthy();
	});

	it("disables adding when no employees are available", () => {
		render(<PayrollAccessForm employees={[]} teams={[]} initialGrants={[]} />);

		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Add payroll officer" }).disabled,
		).toBe(true);
	});

	it("opens an editor for an existing payroll officer", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[
					{ id: "employee-a", name: "Ada Lovelace", email: "ada@example.com" },
					{ id: "employee-b", name: "Grace Hopper", email: "grace@example.com" },
				]}
				teams={[{ id: "team-ops", name: "Ops" }]}
				initialGrants={[
					{
						id: "grant-a",
						payrollEmployeeId: "employee-a",
						scope: "specific",
						teamIds: ["team-ops"],
						employeeIds: ["employee-a"],
					},
				]}
			/>,
		);

		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("1 teams, 1 employees")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Edit" }));

		expect(
			screen
				.getByRole("radio", { name: "Specific teams or employees" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.getByRole("switch", { name: "Ops" }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Ada Lovelace" }).checked).toBe(
			true,
		);
	});

	it("hides specific team and employee controls for all access scope", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[{ id: "employee-a", name: "Ada Lovelace", email: "ada@example.com" }]}
				teams={[{ id: "team-ops", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Add payroll officer" }));
		await user.click(screen.getByRole("radio", { name: "All teams and employees" }));

		expect(
			screen.getByRole("radio", { name: "All teams and employees" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.queryByRole("switch", { name: "Ops" })).toBeNull();
		expect(screen.queryByText("Employees")).toBeNull();
	});

	it("submits a specific payroll officer scope", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[
					{ id: "employee-a", name: "Ada Lovelace", email: "ada@example.com" },
					{ id: "employee-b", name: "Grace Hopper", email: "grace@example.com" },
				]}
				teams={[{ id: "team-ops", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Add payroll officer" }));
		await user.selectOptions(screen.getByLabelText("Payroll officer"), "employee-a");
		await user.click(screen.getByRole("switch", { name: "Ops" }));
		await user.click(screen.getByRole("checkbox", { name: "Grace Hopper" }));
		await user.click(screen.getByRole("button", { name: "Save payroll officer" }));

		await waitFor(() => expect(savePayrollAccessActionMock).toHaveBeenCalledTimes(1));
		expect(savePayrollAccessActionMock).toHaveBeenCalledWith({
			payrollEmployeeId: "employee-a",
			scope: "specific",
			teamIds: ["team-ops"],
			employeeIds: ["employee-b"],
		});
	});

	it("selects a team when its row is clicked and lays teams out in two columns", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[{ id: "employee-a", name: "Ada Lovelace", email: "ada@example.com" }]}
				teams={[
					{ id: "team-ops", name: "Ops" },
					{ id: "team-support", name: "Support" },
				]}
				initialGrants={[]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Add payroll officer" }));

		expect(screen.getByTestId("payroll-access-team-grid").className).toContain("sm:grid-cols-2");

		await user.click(screen.getByTestId("payroll-access-team-team-ops"));

		expect(screen.getByRole("switch", { name: "Ops" }).getAttribute("aria-checked")).toBe("true");
	});

	it("lists existing payroll officers and excludes them when adding another officer", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[
					{ id: "employee-a", name: "Ada Lovelace", email: "ada@example.com" },
					{ id: "employee-b", name: "Grace Hopper", email: "grace@example.com" },
				]}
				teams={[{ id: "team-ops", name: "Ops" }]}
				initialGrants={[
					{
						id: "grant-a",
						payrollEmployeeId: "employee-a",
						scope: "all",
						teamIds: [],
						employeeIds: [],
					},
				]}
			/>,
		);

		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("All teams and employees")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Add payroll officer" }));

		const officerSelect = screen.getByLabelText("Payroll officer");
		expect(officerSelect.textContent).not.toContain("Ada Lovelace");
		expect(officerSelect.textContent).toContain("Grace Hopper");
	});
});
