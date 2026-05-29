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

vi.mock("@/app/[locale]/(app)/settings/demo/actions", () => actionMocks);

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
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
		t: (key: string, fallback?: string, params?: Record<string, string | number>) => {
			const message = getMessage(key) ?? fallback ?? key;
			if (/\$\{[^}]+\}/.test(message)) {
				throw new SyntaxError("MALFORMED_ARGUMENT");
			}
			return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""));
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
		actionMocks.generatePendingTimeCorrectionApprovalsStepAction.mockResolvedValue({
			success: true,
			data: { pendingTimeCorrectionApprovalsCreated: 1 },
		});
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
			expect(actionMocks.generatePendingAbsenceApprovalsStepAction).toHaveBeenCalledWith(
				expect.objectContaining({
					includePendingAbsenceApprovals: true,
					includePendingTimeCorrectionApprovals: true,
					organizationId: "org_1",
				}),
			);
		});
		expect(actionMocks.generatePendingTimeCorrectionApprovalsStepAction).toHaveBeenCalledWith(
			expect.objectContaining({
				includePendingAbsenceApprovals: true,
				includePendingTimeCorrectionApprovals: true,
				organizationId: "org_1",
			}),
		);
	});
});
