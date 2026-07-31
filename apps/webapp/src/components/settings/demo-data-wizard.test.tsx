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
				organizationId="org_1"
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
				organizationId="org_1"
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
				organizationId="org_1"
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
					organizationId: "org_1",
				}),
			);
		});
		expect(
			actionMocks.generatePendingTimeCorrectionApprovalsStepAction,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				includePendingAbsenceApprovals: true,
				includePendingTimeCorrectionApprovals: true,
				organizationId: "org_1",
			}),
		);
	});

	it("re-enables employee generation and does not refresh when generation rejects", async () => {
		const user = userEvent.setup();
		actionMocks.generateDemoEmployeesAction.mockRejectedValue(
			new Error("Network failed"),
		);
		render(<DemoDataWizard employees={[]} organizationId="org_1" />);

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

	it("re-enables clear after the action rejects", async () => {
		const user = userEvent.setup();
		actionMocks.clearTimeDataAction.mockRejectedValue(
			new Error("Network failed"),
		);
		render(<DemoDataWizard employees={[]} organizationId="org_1" />);

		await user.click(screen.getByRole("button", { name: "Clear All Data" }));
		await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
		await user.click(screen.getByRole("button", { name: "Clear All Data" }));
		await user.click(screen.getByRole("button", { name: "Clear All Data" }));

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Clear All Data" }),
			).toHaveProperty("disabled", false),
		);
		expect(screen.getByText("An unexpected error occurred")).toBeTruthy();
		expect(screen.queryByText("Data cleared successfully!")).toBeNull();
	});

	it("re-enables non-admin deletion and does not refresh when deletion rejects", async () => {
		const user = userEvent.setup();
		actionMocks.deleteNonAdminDataAction.mockRejectedValue(
			new Error("Network failed"),
		);
		render(<DemoDataWizard employees={[]} organizationId="org_1" />);

		await user.click(
			screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
		);
		await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
		await user.click(
			screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
		);
		await user.click(
			screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
		);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Delete Non-Admin Employees" }),
			).toHaveProperty("disabled", false),
		);
		expect(screen.getByText("An unexpected error occurred")).toBeTruthy();
		expect(
			screen.queryByText("Non-admin employees deleted successfully!"),
		).toBeNull();
		expect(refresh).not.toHaveBeenCalled();
	});
});
