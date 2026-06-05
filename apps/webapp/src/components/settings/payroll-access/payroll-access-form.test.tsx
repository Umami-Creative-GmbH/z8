// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayrollAccessForm } from "./payroll-access-form";

const { savePayrollAccessActionMock } = vi.hoisted(() => ({
	savePayrollAccessActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: { count?: number }) =>
			params?.count === undefined ? fallback : fallback.replace("{count}", String(params.count)),
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/payroll-access/actions", () => ({
	savePayrollAccessAction: savePayrollAccessActionMock,
}));

describe("PayrollAccessForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		savePayrollAccessActionMock.mockResolvedValue({ success: true, data: { grantId: "grant-id" } });
	});

	it("renders payroll employee, team, and employee selectors", () => {
		render(
			<PayrollAccessForm
				employees={[{ id: "employee-1", name: "Ada Lovelace" }]}
				teams={[{ id: "team-1", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		expect(screen.getByText("Payroll Officers")).toBeTruthy();
		expect(
			screen.getByText(
				"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
			),
		).toBeTruthy();
		expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
		expect(screen.getByText("Ops")).toBeTruthy();
	});

	it("renders an empty state when no employees are available", () => {
		render(<PayrollAccessForm employees={[]} teams={[]} initialGrants={[]} />);

		expect(screen.getByText("No employees available")).toBeTruthy();
	});

	it("resets grant selections when switching payroll employees before submitting", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[
					{ id: "employee-a", name: "Ada Lovelace" },
					{ id: "employee-b", name: "Grace Hopper" },
				]}
				teams={[{ id: "team-ops", name: "Ops" }]}
				initialGrants={[
					{
						id: "grant-a",
						payrollEmployeeId: "employee-a",
						teamIds: ["team-ops"],
						employeeIds: ["employee-a"],
					},
				]}
			/>,
		);

		expect(screen.getByText("1 active payroll officers")).toBeTruthy();
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Ops" }).checked).toBe(true);
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Ada Lovelace" }).checked).toBe(
			true,
		);

		await user.selectOptions(screen.getByLabelText("Payroll officer"), "employee-b");

		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Ops" }).checked).toBe(false);
		expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Ada Lovelace" }).checked).toBe(
			false,
		);

		await user.click(screen.getByRole("button", { name: "Save payroll officer" }));

		await waitFor(() => expect(savePayrollAccessActionMock).toHaveBeenCalledTimes(1));
		expect(savePayrollAccessActionMock).toHaveBeenCalledWith({
			payrollEmployeeId: "employee-b",
			teamIds: [],
			employeeIds: [],
		});
	});

	it("submits deduplicated checkbox selections", async () => {
		const user = userEvent.setup();

		render(
			<PayrollAccessForm
				employees={[
					{ id: "employee-a", name: "Ada Lovelace" },
					{ id: "employee-b", name: "Grace Hopper" },
				]}
				teams={[{ id: "team-ops", name: "Ops" }]}
				initialGrants={[]}
			/>,
		);

		await user.click(screen.getByRole("checkbox", { name: "Ops" }));
		await user.click(screen.getByRole("checkbox", { name: "Grace Hopper" }));
		await user.click(screen.getByRole("button", { name: "Save payroll officer" }));

		await waitFor(() => expect(savePayrollAccessActionMock).toHaveBeenCalledTimes(1));
		expect(savePayrollAccessActionMock).toHaveBeenCalledWith({
			payrollEmployeeId: "employee-a",
			teamIds: ["team-ops"],
			employeeIds: ["employee-b"],
		});
	});
});
