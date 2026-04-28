import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { getManagerDailyBriefingFromSources } from "../get-manager-daily-briefing";
import type { BriefingApproval } from "../types";

describe("getManagerDailyBriefingFromSources", () => {
	it("uses all active organization employees for admins", async () => {
		const sources = createSources();
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
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
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
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
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(sources.getPublishedShifts).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeIds: ["emp-1"],
			date: "2026-04-28",
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
			approverId: "manager-1",
			employeeIds: ["emp-1"],
		});
	});

	it("loads all approvers for admin briefing approvals", async () => {
		const sources = createSources();
		await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(sources.getApprovals).toHaveBeenCalledWith({
			organizationId: "org-1",
			approverId: "admin-1",
			employeeIds: ["emp-1"],
			includeAllApprovers: true,
		});
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
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
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
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
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
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(briefing.summary.openApprovals).toBe(1);
		expect(briefing.sections.approvals.items).toEqual([
			expect.objectContaining({ approvalId: "approval-1", requesterName: "Ada Lovelace" }),
		]);
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
			now: DateTime.fromISO("2026-04-28T08:20:00.000+02:00"),
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
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
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
}: {
	id: string;
	requesterId: string;
	requesterName: string;
}): BriefingApproval {
	return {
		id,
		approvalType: "absence_entry",
		entityId: `entity-${id}`,
		typeName: "absence",
		requester: { id: requesterId, name: requesterName },
		priority: "normal",
		display: { summary: `${requesterName} requested absence` },
	};
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
		...overrides,
	};
}
