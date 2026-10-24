/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeactivationPlan } from "@/lib/employee-lifecycle/deactivation/types";

// Renders English defaults with their parameters, including `{count, plural, one {…} other {…}}`.
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) =>
					text
						.replace(
							new RegExp(`\\{${key}, plural, one \\{([^}]*)\\} other \\{([^}]*)\\}\\}`, "g"),
							(_match, one: string, other: string) =>
								(Number(value) === 1 ? one : other).replaceAll("#", String(value)),
						)
						.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

import {
	DeactivationPreviewDialog,
	type DeactivationPreviewDialogProps,
} from "./deactivation-preview-dialog";

const REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_REPORT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANNA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BEN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function emptyPlan(overrides: Partial<DeactivationPlan> = {}): DeactivationPlan {
	return {
		at: "2026-10-24T08:00:00Z",
		timeZone: "Europe/Berlin",
		managerLinks: {
			reportsNeedingReplacement: [],
			reportsKeepingAnotherManager: [],
			ownManagerLinks: [],
			replacementOptions: [],
		},
		teamLinks: { teams: [], projectAssignments: [], projectManagerLinks: [] },
		approvalDuties: { handovers: [], reviews: [] },
		shifts: { shiftsToOpen: [], plannerRecipientUserIds: [] },
		absences: { absencesToCancel: [], absencesSpanning: [] },
		accessEnds: { grants: [], drivingAuthorizations: [], kioskBadges: [], shareLinks: [] },
		retentionStarts: true,
		seatReleased: true,
		refusals: [],
		...overrides,
	};
}

function planWithReport(): DeactivationPlan {
	return emptyPlan({
		managerLinks: {
			reportsNeedingReplacement: [
				{
					employeeId: REPORT,
					name: "Rita Report",
					wasPrimary: true,
					replacementEmployeeId: null,
					refusal: "replacement_missing",
				},
			],
			reportsKeepingAnotherManager: [],
			ownManagerLinks: [],
			replacementOptions: [
				{ employeeId: ANNA, name: "Anna Admin" },
				{ employeeId: BEN, name: "Ben Manager" },
			],
		},
		refusals: ["replacement_missing"],
	});
}

function renderDialog(overrides: Partial<DeactivationPreviewDialogProps> = {}) {
	const props: DeactivationPreviewDialogProps = {
		open: true,
		onOpenChange: vi.fn(),
		employeeName: "Max Mustermann",
		plan: emptyPlan(),
		isLoading: false,
		loadError: null,
		submitError: null,
		isSubmitting: false,
		onConfirm: vi.fn(),
		onReplacementsChange: vi.fn(),
		...overrides,
	};
	const view = render(<DeactivationPreviewDialog {...props} />);
	return { props, ...view };
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
	await user.click(screen.getByRole("combobox", { name: new RegExp(label) }));
	await user.click(await screen.findByRole("option", { name: option }));
}

describe("DeactivationPreviewDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("confirms with the replacement manager picked for each report left without one", async () => {
		const user = userEvent.setup();
		const { props } = renderDialog({ plan: planWithReport() });

		const section = within(screen.getByRole("region", { name: "Reports who need a new manager" }));
		expect(section.getByText(/would have no current manager left/)).toBeTruthy();
		await pick(user, "New manager for Rita Report", "Ben Manager");
		await user.click(screen.getByRole("button", { name: "Deactivate" }));

		await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith({ [REPORT]: BEN }));
	});

	it("states the previewed instant in the organization's zone, not the viewer's", () => {
		renderDialog({ plan: emptyPlan({ at: "2026-10-24T08:00:00Z", timeZone: "Europe/Berlin" }) });

		// 08:00 UTC is 10:00 in Berlin (summer time).
		expect(screen.getByText(/previewed for .*10:00.*Europe\/Berlin/)).toBeTruthy();
	});

	it("refuses to confirm until every report left without a manager has a replacement", async () => {
		const user = userEvent.setup();
		const { props } = renderDialog({ plan: planWithReport() });

		await user.click(screen.getByRole("button", { name: "Deactivate" }));

		expect(await screen.findByText("Choose a new manager for Rita Report.")).toBeTruthy();
		expect(props.onConfirm).not.toHaveBeenCalled();
	});

	it("reports each pick so the preview can be recalculated with it", async () => {
		const user = userEvent.setup();
		const { props } = renderDialog({ plan: planWithReport() });

		await pick(user, "New manager for Rita Report", "Anna Admin");

		expect(props.onReplacementsChange).toHaveBeenLastCalledWith({ [REPORT]: ANNA });
	});

	it("never offers a report as their own manager", async () => {
		const user = userEvent.setup();
		const plan = planWithReport();
		plan.managerLinks.replacementOptions.push({ employeeId: REPORT, name: "Rita Report" });
		renderDialog({ plan });

		await user.click(screen.getByRole("combobox", { name: /New manager for Rita Report/ }));

		expect(await screen.findByRole("option", { name: "Anna Admin" })).toBeTruthy();
		expect(screen.queryByRole("option", { name: "Rita Report" })).toBeNull();
	});

	it("shows when the picked replacement is no longer eligible and refuses to confirm with it", async () => {
		const user = userEvent.setup();
		const plan = planWithReport();
		plan.managerLinks.reportsNeedingReplacement[0] = {
			...plan.managerLinks.reportsNeedingReplacement[0],
			replacementEmployeeId: BEN,
			refusal: "replacement_ineligible",
		};
		plan.refusals = ["replacement_ineligible"];
		const { props } = renderDialog({ plan });

		const message = "Ben Manager can no longer manage Rita Report. Choose someone else.";
		expect(screen.getByText(message)).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Deactivate" }));
		expect(props.onConfirm).not.toHaveBeenCalled();

		await pick(user, "New manager for Rita Report", "Anna Admin");
		expect(screen.queryByText(message)).toBeNull();
		await user.click(screen.getByRole("button", { name: "Deactivate" }));
		await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith({ [REPORT]: ANNA }));
	});

	it("cannot confirm before the preview has loaded", () => {
		renderDialog({ plan: null, isLoading: true });

		expect(screen.getByRole("status").textContent).toBe("Calculating what changes…");
		expect((screen.getByRole("button", { name: "Deactivate" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("explains a failed preview and offers to load it again", async () => {
		const user = userEvent.setup();
		const onRetry = vi.fn();
		renderDialog({ plan: null, loadError: "The preview could not be loaded.", onRetry });

		expect(screen.getByRole("alert").textContent).toContain("The preview could not be loaded.");
		expect((screen.getByRole("button", { name: "Deactivate" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		await user.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalled();
	});

	it("focuses the server's refusal and keeps the picks for another try", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderDialog({ plan: planWithReport() });

		await pick(user, "New manager for Rita Report", "Ben Manager");
		rerender(
			<DeactivationPreviewDialog
				{...props}
				submitError="Choose a current manager for every report before deactivating."
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Choose a current manager for every report");
		await waitFor(() => expect(document.activeElement).toBe(alert));
		expect(screen.getByRole("combobox", { name: /New manager for Rita Report/ }).textContent).toBe(
			"Ben Manager",
		);
	});

	it("locks the dialog while the deactivation is submitted", () => {
		const { props } = renderDialog({ isSubmitting: true });

		const confirm = screen.getByRole("button", { name: "Deactivating..." }) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
		expect(props.onOpenChange).not.toHaveBeenCalled();
	});

	it("lists the manager links that end", () => {
		renderDialog({
			plan: emptyPlan({
				managerLinks: {
					reportsNeedingReplacement: [],
					reportsKeepingAnotherManager: [
						{ employeeId: REPORT, name: "Rita Report", newPrimaryManagerId: ANNA },
						{ employeeId: SECOND_REPORT, name: "Sam Second", newPrimaryManagerId: null },
					],
					ownManagerLinks: [{ employeeId: BEN, name: "Ben Manager", isPrimary: true }],
					replacementOptions: [{ employeeId: ANNA, name: "Anna Admin" }],
				},
			}),
		});

		const section = within(screen.getByRole("region", { name: "Manager links that end" }));
		expect(
			section.getByText("Rita Report keeps Anna Admin, who becomes the primary manager."),
		).toBeTruthy();
		expect(section.getByText("Sam Second keeps their other manager.")).toBeTruthy();
		expect(section.getByText("Ben Manager (primary manager)")).toBeTruthy();
	});

	it("lists the team memberships and project links that end", () => {
		renderDialog({
			plan: emptyPlan({
				teamLinks: {
					teams: [{ teamId: "team-1", name: "Warehouse" }],
					projectAssignments: [{ projectId: "project-1", name: "Relaunch" }],
					projectManagerLinks: [{ projectId: "project-2", name: "Audit 2026" }],
				},
			}),
		});

		const section = within(screen.getByRole("region", { name: "Teams and projects" }));
		expect(section.getByText("Team: Warehouse")).toBeTruthy();
		expect(section.getByText("Project member: Relaunch")).toBeTruthy();
		expect(section.getByText("Project manager: Audit 2026")).toBeTruthy();
	});

	it("says where pending approval duties go and which become reviews", () => {
		const handover = {
			workflowId: "workflow-1",
			stageId: "stage-1",
			requesterEmployeeId: REPORT,
		};
		renderDialog({
			plan: emptyPlan({
				managerLinks: {
					...emptyPlan().managerLinks,
					replacementOptions: [{ employeeId: ANNA, name: "Anna Admin" }],
				},
				approvalDuties: {
					handovers: [
						{ ...handover, assignmentId: "a-1", targetEmployeeId: ANNA },
						{ ...handover, assignmentId: "a-2", targetEmployeeId: ANNA },
						{ ...handover, assignmentId: "a-3", targetEmployeeId: BEN },
						{ ...handover, assignmentId: "a-4", targetEmployeeId: null },
					],
					reviews: [
						{
							workflowId: "workflow-2",
							stageId: "stage-9",
							approvalRequestId: null,
							reason: "future_stage_without_replacement",
						},
					],
				},
			}),
		});

		const section = within(screen.getByRole("region", { name: "Approval duties" }));
		expect(section.getByText("2 pending approvals move to Anna Admin.")).toBeTruthy();
		expect(
			section.getByText("1 pending approval moves to the workflow's fallback approver."),
		).toBeTruthy();
		expect(
			section.getByText(
				"2 approval duties need a replacement and are listed for review (Approval duties need a replacement).",
			),
		).toBeTruthy();
		expect(section.getByText(/A later approval stage is routed only to this person/)).toBeTruthy();
	});

	it("lists the future shifts that become open", () => {
		renderDialog({
			plan: emptyPlan({
				shifts: {
					shiftsToOpen: [
						{ shiftId: "shift-1", date: "2026-10-26", startTime: "08:00", endTime: "16:00" },
						{ shiftId: "shift-2", date: "2026-10-27", startTime: "22:00", endTime: "06:00" },
					],
					plannerRecipientUserIds: ["planner-1"],
				},
			}),
		});

		const section = within(screen.getByRole("region", { name: "Shifts that become open" }));
		expect(
			section.getByText(
				"2 future shifts are unassigned and stay as open shifts. Planners are notified once.",
			),
		).toBeTruthy();
		expect(section.getByText("Oct 26, 2026, 08:00–16:00")).toBeTruthy();
		expect(section.getByText("Oct 27, 2026, 22:00–06:00")).toBeTruthy();
	});

	it("lists the absences that are cancelled and the spanning ones that are kept", () => {
		renderDialog({
			plan: emptyPlan({
				absences: {
					absencesToCancel: [
						{
							absenceId: "absence-1",
							categoryName: "Vacation",
							startDate: "2026-11-02",
							endDate: "2026-11-06",
							status: "approved",
						},
						{
							absenceId: "absence-2",
							categoryName: "Training",
							startDate: "2026-12-01",
							endDate: "2026-12-01",
							status: "pending",
						},
					],
					absencesSpanning: [
						{
							absenceId: "absence-3",
							categoryName: "Sick leave",
							startDate: "2026-10-22",
							endDate: "2026-10-28",
							status: "approved",
						},
					],
				},
			}),
		});

		const section = within(screen.getByRole("region", { name: "Absences" }));
		expect(section.getByText("Cancelled, allowance restored")).toBeTruthy();
		expect(section.getByText("Vacation, Nov 2 – 6, 2026 (approved)")).toBeTruthy();
		expect(section.getByText("Training, Dec 1, 2026 (pending)")).toBeTruthy();
		expect(section.getByText("Kept, because they have already started")).toBeTruthy();
		expect(section.getByText("Sick leave, Oct 22 – 28, 2026 (approved)")).toBeTruthy();
	});

	it("lists the access that ends", () => {
		renderDialog({
			plan: emptyPlan({
				accessEnds: {
					grants: [
						{ kind: "expense_officer", grantId: "g-1" },
						{ kind: "payroll_access", grantId: "g-2" },
						{ kind: "personnel_file_officer", grantId: "g-3" },
						{ kind: "driving_licence_verifier", grantId: "g-4" },
					],
					drivingAuthorizations: [
						{ authorizationId: "d-1", state: "active" },
						{ authorizationId: "d-2", state: "suspended" },
					],
					kioskBadges: [{ badgeId: "b-1" }],
					shareLinks: [
						{ linkId: "l-1", kind: "report" },
						{ linkId: "l-2", kind: "report" },
						{ linkId: "l-3", kind: "report" },
					],
				},
			}),
		});

		const section = within(screen.getByRole("region", { name: "Access that ends" }));
		expect(section.getByText("Travel expense officer")).toBeTruthy();
		expect(section.getByText("Payroll access")).toBeTruthy();
		expect(section.getByText("Personnel file officer")).toBeTruthy();
		expect(section.getByText("Driving licence verifier")).toBeTruthy();
		expect(
			section.getByText("2 driving authorizations end, including suspended ones"),
		).toBeTruthy();
		expect(section.getByText("1 kiosk badge is revoked")).toBeTruthy();
		expect(section.getByText("3 report share links are revoked")).toBeTruthy();
	});

	it("says that retention starts and the paid seat is released", () => {
		renderDialog({ plan: emptyPlan() });

		const section = within(screen.getByRole("region", { name: "Records and billing" }));
		expect(section.getByText("Personnel file retention starts now.")).toBeTruthy();
		expect(section.getByText("Their paid seat is released.")).toBeTruthy();
	});

	it("leaves out areas the deactivation does not touch", () => {
		renderDialog({ plan: emptyPlan({ retentionStarts: false, seatReleased: false }) });

		expect(screen.queryAllByRole("region")).toHaveLength(0);
		expect(screen.getByText("Nothing else changes.")).toBeTruthy();
	});

	it("keeps the picks when the recalculated preview arrives", async () => {
		const user = userEvent.setup();
		const { props, rerender } = renderDialog({ plan: planWithReport() });

		await pick(user, "New manager for Rita Report", "Ben Manager");
		rerender(<DeactivationPreviewDialog {...props} plan={planWithReport()} />);
		await user.click(screen.getByRole("button", { name: "Deactivate" }));

		await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith({ [REPORT]: BEN }));
	});
});
