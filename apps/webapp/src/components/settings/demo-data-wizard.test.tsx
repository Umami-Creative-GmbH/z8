/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import settingsDemoMessages from "../../../messages/settings/demo/en.json";
import { DemoDataWizard } from "./demo-data-wizard";

const actionMocks = vi.hoisted(() => ({
	assignWorkCategoriesToPeriodsStepAction: vi.fn(),
	clearTimeDataAction: vi.fn(),
	deleteNonAdminDataAction: vi.fn(),
	generateAbsencesStepAction: vi.fn(),
	generateChangePoliciesStepAction: vi.fn(),
	generateDemoEmployeesAction: vi.fn(),
	generateLocationsStepAction: vi.fn(),
	generateManagersStepAction: vi.fn(),
	generatePendingAbsenceApprovalsStepAction: vi.fn(),
	generatePendingTimeCorrectionApprovalsStepAction: vi.fn(),
	generateProjectsStepAction: vi.fn(),
	generateShiftsStepAction: vi.fn(),
	generateShiftTemplatesStepAction: vi.fn(),
	generateTeamsStepAction: vi.fn(),
	generateTimeEntriesStepAction: vi.fn(),
	generateWorkCategoriesStepAction: vi.fn(),
}));
const refresh = vi.fn();

vi.mock("@/app/[locale]/(app)/settings/demo/actions", () => actionMocks);

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

const getMessage = (key: string): string | undefined => {
	const parts = key.split(".");
	let current: unknown = settingsDemoMessages;

	for (const part of parts) {
		if (!current || typeof current !== "object" || !(part in current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === "string" ? current : undefined;
};

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			key: string,
			fallback?: string,
			params?: Record<string, string | number>,
		) => {
			const message = getMessage(key) ?? fallback ?? key;
			if (/\$\{[^}]+\}/.test(message)) {
				throw new SyntaxError("MALFORMED_ARGUMENT");
			}
			return message.replace(/\{(\w+)\}/g, (_match, name: string) =>
				String(params?.[name] ?? ""),
			);
		},
	}),
}));

describe("DemoDataWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actionMocks.generateManagersStepAction.mockResolvedValue({
			success: true,
			data: { managerAssignmentsCreated: 0 },
		});
		actionMocks.generateTimeEntriesStepAction.mockResolvedValue({
			success: true,
			data: { timeEntriesCreated: 0, workPeriodsCreated: 0 },
		});
		actionMocks.generateAbsencesStepAction.mockResolvedValue({
			success: true,
			data: { absencesCreated: 0 },
		});
		actionMocks.generatePendingAbsenceApprovalsStepAction.mockResolvedValue({
			success: true,
			data: { pendingAbsenceApprovalsCreated: 2 },
		});
		actionMocks.generatePendingTimeCorrectionApprovalsStepAction.mockResolvedValue(
			{
				success: true,
				data: { pendingTimeCorrectionApprovalsCreated: 1 },
			},
		);
	});

	it("renders the all employees option with the localized employee count", () => {
		render(
			<DemoDataWizard
				employees={[
					{ id: "emp_1", name: "Ada Lovelace" },
					{ id: "emp_2", name: "Grace Hopper" },
				]}
			/>,
		);

		expect(screen.getByText("All employees (2)")).toBeTruthy();
	});

	it("renders approval testing options", () => {
		render(
			<DemoDataWizard
				employees={[
					{ id: "emp_1", name: "Ada Lovelace" },
					{ id: "emp_2", name: "Grace Hopper" },
				]}
			/>,
		);

		expect(screen.getByText("Approvals Testing")).toBeTruthy();
		expect(screen.getByText("Pending absence approvals")).toBeTruthy();
		expect(screen.getByText("Pending time correction approvals")).toBeTruthy();
	});

	it("runs selected pending approval generation steps", async () => {
		const user = userEvent.setup();

		render(
			<DemoDataWizard
				employees={[
					{ id: "emp_1", name: "Ada Lovelace" },
					{ id: "emp_2", name: "Grace Hopper" },
				]}
			/>,
		);

		await user.click(screen.getByText("Pending absence approvals"));
		await user.click(screen.getByText("Pending time correction approvals"));
		await user.click(screen.getByRole("button", { name: /generate data/i }));

		await waitFor(() => {
			expect(
				actionMocks.generatePendingAbsenceApprovalsStepAction,
			).toHaveBeenCalledWith(
				expect.objectContaining({
					includePendingAbsenceApprovals: true,
					includePendingTimeCorrectionApprovals: true,
				}),
			);
		});
		expect(
			actionMocks.generatePendingTimeCorrectionApprovalsStepAction,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				includePendingAbsenceApprovals: true,
				includePendingTimeCorrectionApprovals: true,
			}),
		);
	});

	it("explains a failed employee load, offers a retry and blocks generation", async () => {
		const user = userEvent.setup();
		render(<DemoDataWizard employees={[]} employeesLoadFailed />);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Employees could not be loaded");
		expect(screen.queryByText("All employees (0)")).toBeNull();

		const generate = screen.getByRole("button", { name: /generate data/i });
		expect(generate).toHaveProperty("disabled", true);

		await user.click(screen.getByRole("button", { name: "Retry" }));

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(actionMocks.generateTimeEntriesStepAction).not.toHaveBeenCalled();
	});

	it("does not show the employee load error once employees loaded", () => {
		render(
			<DemoDataWizard employees={[{ id: "emp_1", name: "Ada Lovelace" }]} />,
		);

		expect(screen.queryByText("Employees could not be loaded")).toBeNull();
		expect(
			screen.getByRole("button", { name: /generate data/i }),
		).toHaveProperty("disabled", false);
	});

	it("offers the work-period assignment as a separate option below the Work Categories card", async () => {
		const user = userEvent.setup();
		render(
			<DemoDataWizard employees={[{ id: "emp_1", name: "Ada Lovelace" }]} />,
		);

		expect(
			screen.queryByRole("checkbox", { name: "Also assign to work periods" }),
		).toBeNull();

		const card = screen.getByRole("checkbox", { name: "Work Categories" });
		await user.click(card);
		expect(card.getAttribute("aria-checked")).toBe("true");

		const assign = screen.getByRole("checkbox", {
			name: "Also assign to work periods",
		});
		// The sub-option is not nested inside the selectable card.
		expect(card.contains(assign)).toBe(false);
		expect(assign.getAttribute("aria-checked")).toBe("true");

		await user.click(assign);

		expect(assign.getAttribute("aria-checked")).toBe("false");
		// Toggling the sub-option leaves the Work Categories selection alone.
		expect(card.getAttribute("aria-checked")).toBe("true");
	});

	it("re-enables employee generation and does not refresh when generation rejects", async () => {
		const user = userEvent.setup();
		actionMocks.generateDemoEmployeesAction.mockRejectedValue(
			new Error("Network failed"),
		);
		render(<DemoDataWizard employees={[]} />);

		await user.click(
			screen.getByRole("button", { name: "Generate 5 Employees" }),
		);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Generate 5 Employees" }),
			).toHaveProperty("disabled", false),
		);
		expect(screen.getByText("An unexpected error occurred")).toBeTruthy();
		expect(screen.queryByText("Employees generated successfully!")).toBeNull();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("keeps the clear confirmation open with the failure and re-enables a retry", async () => {
		const user = userEvent.setup();
		actionMocks.clearTimeDataAction.mockRejectedValue(
			new Error("Network failed"),
		);
		render(<DemoDataWizard employees={[]} />);

		await user.click(screen.getByRole("button", { name: "Clear All Data" }));
		const confirm = screen.getByRole("button", { name: "Clear All Data" });
		expect(confirm).toHaveProperty("disabled", true);
		await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
		await user.click(confirm);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Clear All Data" }),
			).toHaveProperty("disabled", false),
		);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(
			screen.getAllByRole("alert").some((alert) =>
				alert.textContent?.includes("An unexpected error occurred"),
			),
		).toBe(true);
		expect(screen.getByLabelText("Type DELETE to confirm")).toHaveProperty(
			"value",
			"DELETE",
		);
		expect(actionMocks.clearTimeDataAction).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Data cleared successfully!")).toBeNull();
	});

	it("closes the clear confirmation once the data is cleared", async () => {
		const user = userEvent.setup();
		actionMocks.clearTimeDataAction.mockResolvedValue({
			success: true,
			data: {
				timeEntriesDeleted: 1,
				workPeriodsDeleted: 1,
				absencesDeleted: 0,
				vacationAllowancesReset: 0,
				teamsDeleted: 0,
				projectsDeleted: 0,
				managerAssignmentsDeleted: 0,
				locationsDeleted: 0,
				subareasDeleted: 0,
				vehiclesDeleted: 0,
				workCategorySetsDeleted: 0,
				workCategoriesDeleted: 0,
				changePoliciesDeleted: 0,
				shiftTemplatesDeleted: 0,
				shiftsDeleted: 0,
				shiftRequestsDeleted: 0,
			},
		});
		render(<DemoDataWizard employees={[]} />);

		await user.click(screen.getByRole("button", { name: "Clear All Data" }));
		await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
		await user.click(screen.getByRole("button", { name: "Clear All Data" }));

		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(screen.getByText("Data cleared successfully!")).toBeTruthy();
	});

	it("keeps the non-admin deletion open with the failure and does not refresh", async () => {
		const user = userEvent.setup();
		actionMocks.deleteNonAdminDataAction.mockRejectedValue(
			new Error("Network failed"),
		);
		render(<DemoDataWizard employees={[]} />);

		await user.click(
			screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
		);
		await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
		await user.click(
			screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
		);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
			).toHaveProperty("disabled", false),
		);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(
			screen.getAllByRole("alert").some((alert) =>
				alert.textContent?.includes("An unexpected error occurred"),
			),
		).toBe(true);
		expect(
			screen.queryByText("Non-admin employees deleted successfully!"),
		).toBeNull();
		expect(refresh).not.toHaveBeenCalled();
	});
});
