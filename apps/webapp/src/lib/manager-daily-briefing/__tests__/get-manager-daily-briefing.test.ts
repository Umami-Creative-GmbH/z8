import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { getManagerDailyBriefingFromSources } from "../get-manager-daily-briefing";

describe("getManagerDailyBriefingFromSources", () => {
	it("uses all active organization employees for admins", async () => {
		const sources = createSources();
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(sources.getScopedEmployees).toHaveBeenCalledWith({ organizationId: "org-1", currentEmployeeId: "admin-1", role: "admin" });
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

		expect(sources.getScopedEmployees).toHaveBeenCalledWith({ organizationId: "org-1", currentEmployeeId: "manager-1", role: "manager" });
	});

	it("passes organization and scoped employee IDs to employee-scoped sources", async () => {
		const sources = createSources();
		await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(sources.getPublishedShifts).toHaveBeenCalledWith({ organizationId: "org-1", employeeIds: ["emp-1"], date: "2026-04-28" });
		expect(sources.getOpenTimeRecords).toHaveBeenCalledWith({ organizationId: "org-1", employeeIds: ["emp-1"], from: expect.any(Date), to: expect.any(Date) });
		expect(sources.getApprovedAbsences).toHaveBeenCalledWith({ organizationId: "org-1", employeeIds: ["emp-1"], date: "2026-04-28" });
	});

	it("keeps rendering sections when approvals fail", async () => {
		const sources = createSources({ getApprovals: vi.fn().mockRejectedValue(new Error("approval query failed")) });
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(briefing.sections.approvals.error).toBe("approval query failed");
		expect(briefing.summary.attendanceExceptions).toBe(1);
	});
});

function createSources(overrides = {}) {
	return {
		getScopedEmployees: vi.fn().mockResolvedValue([{ id: "emp-1", name: "Ada Lovelace", teamName: "Operations" }]),
		getPublishedShifts: vi.fn().mockResolvedValue([{ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", date: "2026-04-28", startTime: "09:00", endTime: "17:00", status: "published" }]),
		getOpenTimeRecords: vi.fn().mockResolvedValue([]),
		getApprovedAbsences: vi.fn().mockResolvedValue([]),
		getCoverageRules: vi.fn().mockResolvedValue([]),
		getApprovals: vi.fn().mockResolvedValue([]),
		getOvertimeWarnings: vi.fn().mockResolvedValue([]),
		getPayrollIssues: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}
