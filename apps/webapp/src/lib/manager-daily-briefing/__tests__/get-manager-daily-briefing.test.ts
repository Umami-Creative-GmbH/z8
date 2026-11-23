import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { getManagerDailyBriefingFromSources } from "../get-manager-daily-briefing";
import type { ApprovalInboxItem, ApprovalInboxType } from "@/lib/approvals/inbox/types";
import { briefingInboxApproval } from "../testing/briefing-approval.test-fixture";
import type { BriefingApproval } from "../types";

describe("getManagerDailyBriefingFromSources", () => {
	it("reports a failed driving check separately from an empty operational queue", async () => {
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-11-16T09:00:00Z"),
			timezone: "Europe/Berlin",
			sources: createSources({
				getDrivingDetailsMissingCount: vi.fn().mockRejectedValue(new Error("offline")),
			}),
		});
		expect(briefing.needsActionError).toBe("Driving details could not be checked.");
	});
	it("uses the supplied business timezone for the local briefing day and record window", async () => {
		const sources = createSources();
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-27T22:30:00.000Z"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.date).toBe("2026-04-28");
		expect(sources.getPublishedShifts).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			date: "2026-04-28",
			timezone: "Europe/Berlin",
		});
		expect(sources.getOpenTimeRecords).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			from: new Date("2026-04-27T20:00:00.000Z"),
			to: new Date("2026-04-29T21:59:59.999Z"),
		});
	});

	it("uses the supplied business timezone to evaluate daily coverage", async () => {
		const sources = createSources({
			getCoverageRules: vi.fn().mockResolvedValue([
				{
					id: "rule-1",
					subareaId: "subarea-1",
					subareaName: "Front desk",
					dayOfWeek: "tuesday",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 2,
				},
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-27T22:30:00.000Z"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.sections.coverage.items).toEqual([
			expect.objectContaining({ id: "coverage:rule-1" }),
		]);
	});

	it("uses all active organization employees for admins", async () => {
		const sources = createSources();
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(sources.getScopedEmployees).toHaveBeenCalledWith({
			organizationId: "org-1",
			currentEmployeeId: "admin-1",
			role: "admin",
		});
		expect(briefing.summary.attendanceExceptions).toBe(1);
	});

	it("uses managed employees for managers", async () => {
		const sources = createSources();
		await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(sources.getScopedEmployees).toHaveBeenCalledWith({
			organizationId: "org-1",
			currentEmployeeId: "manager-1",
			role: "manager",
		});
	});

	it("passes organization and scoped employee IDs to employee-scoped sources", async () => {
		const sources = createSources();
		await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(sources.getPublishedShifts).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			date: "2026-04-28",
			timezone: "Europe/Berlin",
		});
		expect(sources.getOpenTimeRecords).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			from: expect.any(Date),
			to: expect.any(Date),
		});
		expect(sources.getApprovedAbsences).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			date: "2026-04-28",
		});
		expect(sources.getApprovals).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			viewer: { id: "manager-1", role: "manager" },
		});
	});

	it("reads an admin's approvals as the admin's own Approval inbox shows them", async () => {
		const sources = createSources();
		await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(sources.getApprovals).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			viewer: { id: "admin-1", role: "admin" },
		});
	});

	it("lists every unified inbox type, period submissions and compliance exceptions included", async () => {
		const sources = createSources({
			getApprovals: vi.fn().mockResolvedValue([
				createApproval({
					id: "period-1",
					type: "period_submission",
					title: "Period submission",
					detail: "April 2026",
					requesterId: "emp-1",
					requesterName: "Ada Lovelace",
				}),
				createApproval({
					id: "exception-1",
					type: "compliance_exception",
					title: "ArbZG exception: Rest Period",
					detail: "Customer go-live",
					priority: "high",
					requesterId: "emp-1",
					requesterName: "Ada Lovelace",
					capabilities: { canBulkApprove: false, singleDecisionOnly: true },
				}),
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(2);
		expect(briefing.sections.approvals.items).toEqual([
			expect.objectContaining({
				id: "approval:exception-1",
				approvalId: "exception-1",
				approvalType: "compliance_exception",
				entityId: "entity-exception-1",
				severity: "high",
				title: "Ada Lovelace: ArbZG exception: Rest Period",
				summary: "Customer go-live",
				requesterName: "Ada Lovelace",
				href: "/approvals/inbox?types=compliance_exception",
			}),
			expect.objectContaining({
				id: "approval:period-1",
				approvalType: "period_submission",
				severity: "warning",
				title: "Ada Lovelace: Period submission",
				summary: "April 2026",
				href: "/approvals/inbox?types=period_submission",
			}),
		]);
	});

	it("carries the inbox item's detail-review requirement", async () => {
		const sources = createSources({
			getApprovals: vi.fn().mockResolvedValue([
				createApproval({
					id: "report-1",
					type: "travel_expense_report",
					requesterId: "emp-1",
					requesterName: "Ada Lovelace",
					capabilities: { canApprove: false, requiresDetailReview: true },
				}),
				createApproval({ id: "absence-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		const byApprovalId = new Map(
			briefing.sections.approvals.items.map((item) => [item.approvalId, item]),
		);
		expect(byApprovalId.get("report-1")?.requiresDetailReview).toBe(true);
		expect(byApprovalId.get("absence-1")?.requiresDetailReview).toBeUndefined();
	});

	it("carries the inbox item's localized summary texts for the panel to translate", async () => {
		const localized = {
			title: { key: "approvals:approvals.periodSubmission.title", fallback: "Period submission" },
			subtitle: {
				key: "approvals:approvals.canonicalRequester",
				fallback: "Requested by {name}",
				params: { name: "Ada Lovelace" },
			},
			detail: { key: "approvals:approvals.periodSubmission.hours", fallback: "{hours} hours" },
		};
		const localizedApproval = createApproval({
			id: "period-1",
			type: "period_submission",
			requesterId: "emp-1",
			requesterName: "Ada Lovelace",
		});
		localizedApproval.summary.localized = localized;
		const sources = createSources({
			getApprovals: vi
				.fn()
				.mockResolvedValue([
					localizedApproval,
					createApproval({ id: "absence-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
				]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		const byApprovalId = new Map(
			briefing.sections.approvals.items.map((item) => [item.approvalId, item]),
		);
		expect(byApprovalId.get("period-1")?.localized).toEqual(localized);
		expect(byApprovalId.get("absence-1")?.localized).toBeUndefined();
	});

	it("counts every pending approval of the briefing's employees, not only those it shows", async () => {
		const shown = [
			createApproval({ id: "approval-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
			createApproval({ id: "approval-2", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
		];
		const sources = createSources({
			getApprovals: vi.fn().mockResolvedValue(Object.assign(shown, { totalCount: 40 })),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.sections.approvals.items).toHaveLength(2);
		expect(briefing.summary.openApprovals).toBe(40);
	});

	it("never counts fewer open approvals than it lists, even when a count read failed", async () => {
		const shown = [
			createApproval({ id: "approval-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
			createApproval({ id: "approval-2", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
			createApproval({ id: "approval-3", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
		];
		// The list read succeeded but the failed count read came back as 0.
		const sources = createSources({
			getApprovals: vi.fn().mockResolvedValue(Object.assign(shown, { totalCount: 0 })),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(3);
	});

	it("names the approval types the inbox could not list, so the count never meets a silent empty list", async () => {
		const sources = createSources({
			getApprovals: vi
				.fn()
				.mockResolvedValue(
					Object.assign([], { totalCount: 3, unavailableTypes: ["travel_expense_claim"] }),
				),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(3);
		expect(briefing.sections.approvals.items).toEqual([]);
		expect(briefing.sections.approvals.unavailableTypes).toEqual(["travel_expense_claim"]);
	});

	it("names the approval types the inbox listed but could not count, apart from those it could not list", async () => {
		const shown = [
			createApproval({ id: "approval-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
		];
		const sources = createSources({
			getApprovals: vi.fn().mockResolvedValue(
				Object.assign(shown, {
					totalCount: 0,
					unavailableTypes: ["period_submission"],
					uncountedTypes: ["absence_entry"],
				}),
			),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(1);
		expect(briefing.sections.approvals.unavailableTypes).toEqual(["period_submission"]);
		expect(briefing.sections.approvals.uncountedTypes).toEqual(["absence_entry"]);
	});

	it("names no unavailable approval types when the inbox listed every one", async () => {
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources: createSources(),
		});

		expect(briefing.sections.approvals.unavailableTypes).toBeUndefined();
		expect(briefing.sections.approvals.uncountedTypes).toBeUndefined();
	});

	it("carries the inbox item's approve and reject capabilities", async () => {
		const sources = createSources({
			getApprovals: vi.fn().mockResolvedValue([
				createApproval({
					id: "correction-1",
					type: "time_entry",
					requesterId: "emp-1",
					requesterName: "Ada Lovelace",
					capabilities: { canApprove: false, canReject: false },
				}),
				createApproval({
					id: "blocked-1",
					requesterId: "emp-1",
					requesterName: "Ada Lovelace",
					capabilities: { canApprove: false, canReject: true },
				}),
				createApproval({ id: "absence-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		const byApprovalId = new Map(
			briefing.sections.approvals.items.map((item) => [item.approvalId, item]),
		);
		expect(byApprovalId.get("correction-1")).toMatchObject({ canApprove: false, canReject: false });
		expect(byApprovalId.get("blocked-1")).toMatchObject({ canApprove: false, canReject: true });
		expect(byApprovalId.get("absence-1")).toMatchObject({ canApprove: true, canReject: true });
	});

	it("does not surface manager coverage risks for subareas outside scoped shifts", async () => {
		const sources = createSources({
			getCoverageRules: vi.fn().mockResolvedValue([
				{
					id: "rule-1",
					subareaId: "subarea-1",
					subareaName: "Front desk",
					dayOfWeek: "tuesday",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 2,
				},
				{
					id: "rule-2",
					subareaId: "subarea-2",
					subareaName: "Loading dock",
					dayOfWeek: "tuesday",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 1,
				},
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.sections.coverage.items).toEqual([
			expect.objectContaining({ id: "coverage:rule-1", title: "Front desk is understaffed" }),
		]);
		expect(briefing.sections.coverage.items).not.toEqual([
			expect.objectContaining({ title: expect.stringContaining("Loading dock") }),
		]);
	});

	it("does not surface org-wide coverage risks when a manager has no scoped shifts today", async () => {
		const sources = createSources({
			getPublishedShifts: vi.fn().mockResolvedValue([]),
			getCoverageRules: vi.fn().mockResolvedValue([
				{
					id: "rule-1",
					subareaId: "subarea-1",
					subareaName: "Front desk",
					dayOfWeek: "tuesday",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 1,
				},
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.sections.coverage.items).toEqual([]);
	});

	it("excludes approvals requested by employees outside the scoped employees", async () => {
		const sources = createSources({
			getApprovals: vi
				.fn()
				.mockResolvedValue([
					createApproval({ id: "approval-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
					createApproval({ id: "approval-2", requesterId: "emp-2", requesterName: "Grace Hopper" }),
				]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(1);
		expect(briefing.sections.approvals.items).toEqual([
			expect.objectContaining({ approvalId: "approval-1", requesterName: "Ada Lovelace" }),
		]);
	});

	it("marks the viewer's own pending request so no decision is offered", async () => {
		const sources = createSources({
			getScopedEmployees: vi.fn().mockResolvedValue([
				{ id: "admin-1", name: "Alan Turing", teamName: null },
				{ id: "emp-1", name: "Ada Lovelace", teamName: "Operations" },
			]),
			getApprovals: vi.fn().mockResolvedValue([
				createApproval({
					id: "approval-own",
					requesterId: "admin-1",
					requesterName: "Alan Turing",
					capabilities: { canApprove: false, canReject: false, ownRequest: true },
				}),
				createApproval({ id: "approval-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
			]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		const byApprovalId = new Map(
			briefing.sections.approvals.items.map((item) => [item.approvalId, item]),
		);
		expect(byApprovalId.get("approval-own")?.ownRequest).toBe(true);
		expect(byApprovalId.get("approval-1")?.ownRequest).toBeUndefined();
		expect(briefing.summary.openApprovals).toBe(2);
	});

	it("excludes approval items from needs action while keeping approval sections and summary counts", async () => {
		const sources = createSources({
			getApprovals: vi
				.fn()
				.mockResolvedValue([
					createApproval({ id: "approval-1", requesterId: "emp-1", requesterName: "Ada Lovelace" }),
				]),
		});

		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T08:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(1);
		expect(briefing.sections.approvals.items).toEqual([
			expect.objectContaining({ approvalId: "approval-1", category: "approval" }),
		]);
		expect(briefing.needsAction).not.toEqual([expect.objectContaining({ category: "approval" })]);
	});

	it("keeps rendering sections when approvals fail", async () => {
		const sources = createSources({
			getApprovals: vi.fn().mockRejectedValue(new Error("approval query failed")),
		});
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: parseInstant("2026-04-28T09:20:00.000+02:00"),
			timezone: "Europe/Berlin",
			sources,
		});

		expect(briefing.sections.approvals.error).toBe("Section could not be loaded.");
		expect(briefing.summary.attendanceExceptions).toBe(1);
	});
});

function createApproval({
	id,
	requesterId,
	requesterName,
	type = "absence_entry",
	title = "Vacation",
	detail = `${requesterName} requested absence`,
	priority = "normal",
	capabilities = {},
}: {
	id: string;
	requesterId: string;
	requesterName: string;
	type?: ApprovalInboxType;
	title?: string;
	detail?: string;
	priority?: ApprovalInboxItem["triage"]["priority"];
	capabilities?: Partial<ApprovalInboxItem["capabilities"]>;
}): BriefingApproval {
	return briefingInboxApproval({
		id,
		type,
		title,
		detail,
		priority,
		capabilities,
		requester: { id: requesterId, name: requesterName },
	});
}

function createSources(overrides = {}) {
	return {
		getScopedEmployees: vi
			.fn()
			.mockResolvedValue([{ id: "emp-1", name: "Ada Lovelace", teamName: "Operations" }]),
		getPublishedShifts: vi.fn().mockResolvedValue([
			{
				id: "shift-1",
				employeeId: "emp-1",
				employeeName: "Ada Lovelace",
				teamName: "Operations",
				date: "2026-04-28",
				startTime: "09:00",
				endTime: "17:00",
				status: "published",
				subareaId: "subarea-1",
				subareaName: "Front desk",
			},
		]),
		getOpenTimeRecords: vi.fn().mockResolvedValue([]),
		getApprovedAbsences: vi.fn().mockResolvedValue([]),
		getCoverageRules: vi.fn().mockResolvedValue([]),
		getApprovals: vi.fn().mockResolvedValue([]),
		getOvertimeWarnings: vi.fn().mockResolvedValue([]),
		getPayrollIssues: vi.fn().mockResolvedValue([]),
		getDrivingDetailsMissingCount: vi.fn().mockResolvedValue(0),
		...overrides,
	};
}

describe("driving details missing in the briefing (#1127)", () => {
	const now = parseInstant("2026-04-28T09:20:00.000+02:00");

	it("counts the scoped employees' work lacking driving details and links to the team list", async () => {
		const sources = createSources({
			getDrivingDetailsMissingCount: vi.fn().mockResolvedValue(3),
		});
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now,
			timezone: "Europe/Berlin",
			sources,
		});

		expect(sources.getDrivingDetailsMissingCount).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
		});
		expect(briefing.needsAction).toContainEqual(
			expect.objectContaining({
				id: "driving:details-missing",
				category: "driving",
				severity: "warning",
				title: "Driving details missing (3)",
				titleKey: "today.briefing.items.drivingDetailsMissing.title",
				titleParams: { count: 3 },
				href: "/team/driving",
			}),
		);
	});

	it("shows nothing when no work lacks driving details, or the count cannot be read", async () => {
		for (const getDrivingDetailsMissingCount of [
			vi.fn().mockResolvedValue(0),
			vi.fn().mockRejectedValue(new Error("down")),
		]) {
			const briefing = await getManagerDailyBriefingFromSources({
				organizationId: "org-1",
				currentEmployee: { id: "manager-1", role: "manager" },
				now,
				timezone: "Europe/Berlin",
				sources: createSources({ getDrivingDetailsMissingCount }),
			});
			expect(briefing.needsAction.map((item) => item.category)).not.toContain("driving");
		}
	});
});
