import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
	buildSummaryCounts,
	detectAbsencesToday,
	detectAttendanceExceptions,
	detectCoverageRisks,
	sortActionItems,
} from "../logic";
import type { BriefingActionItem } from "../types";

describe("manager daily briefing logic", () => {
	it("detects missing and late clock-ins from published shifts only", () => {
		const now = DateTime.fromISO("2026-04-28T09:20:00.000+02:00");
		const shifts = [
			{ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", date: "2026-04-28", startTime: "09:00", endTime: "17:00", status: "published" as const },
			{ id: "shift-2", employeeId: "emp-2", employeeName: "Grace Hopper", teamName: "Operations", date: "2026-04-28", startTime: "10:00", endTime: "18:00", status: "published" as const },
			{ id: "shift-3", employeeId: "emp-3", employeeName: "Draft Employee", teamName: "Operations", date: "2026-04-28", startTime: "08:00", endTime: "16:00", status: "draft" as const },
			{ id: "shift-4", employeeId: "emp-4", employeeName: "Katherine Johnson", teamName: "Operations", date: "2026-04-28", startTime: "08:30", endTime: "16:30", status: "published" as const },
		];
		const records = [
			{ id: "record-1", employeeId: "emp-2", startAt: DateTime.fromISO("2026-04-28T09:55:00.000+02:00").toJSDate(), endAt: null },
			{ id: "record-2", employeeId: "emp-4", startAt: DateTime.fromISO("2026-04-28T08:40:00.000+02:00").toJSDate(), endAt: null },
		];
		expect(detectAttendanceExceptions({ now, shifts, records, graceMinutes: 5 })).toEqual([
			expect.objectContaining({ id: "attendance:shift-1", severity: "critical", category: "attendance", title: "Ada Lovelace has not clocked in" }),
			expect.objectContaining({ id: "attendance:shift-4", severity: "high", category: "attendance", title: "Katherine Johnson clocked in late" }),
		]);
	});

	it("matches attendance records to the shift window before suppressing exceptions", () => {
		const now = DateTime.fromISO("2026-04-28T14:20:00.000+02:00");
		const shifts = [
			{ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", date: "2026-04-28", startTime: "09:00", endTime: "12:00", status: "published" as const },
			{ id: "shift-2", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", date: "2026-04-28", startTime: "14:00", endTime: "18:00", status: "published" as const },
		];
		const records = [
			{ id: "record-1", employeeId: "emp-1", startAt: DateTime.fromISO("2026-04-28T09:03:00.000+02:00").toJSDate(), endAt: DateTime.fromISO("2026-04-28T12:00:00.000+02:00").toJSDate() },
		];

		expect(detectAttendanceExceptions({ now, shifts, records, graceMinutes: 5 })).toEqual([
			expect.objectContaining({ id: "attendance:shift-2", severity: "critical", category: "attendance", title: "Ada Lovelace has not clocked in" }),
		]);
	});

	it("returns approved absences overlapping today", () => {
		const today = DateTime.fromISO("2026-04-28T12:00:00.000+02:00");
		const result = detectAbsencesToday({
			today,
			absences: [
				{ id: "absence-1", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", categoryName: "Vacation", startDate: "2026-04-27", endDate: "2026-04-29", status: "approved" as const },
				{ id: "absence-2", employeeId: "emp-2", employeeName: "Grace Hopper", teamName: "Operations", categoryName: "Sick leave", startDate: "2026-04-28", endDate: "2026-04-28", status: "pending" as const },
			],
		});
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ id: "absence:absence-1", title: "Ada Lovelace is absent" });
	});

	it("detects coverage risks when staffing is below the rule minimum", () => {
		const risks = detectCoverageRisks({
			dayOfWeek: "tuesday",
			coverageRules: [{ id: "rule-1", subareaId: "subarea-1", subareaName: "Front desk", dayOfWeek: "tuesday", startTime: "09:00", endTime: "12:00", minimumStaffCount: 2 }],
			publishedShifts: [{ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", subareaId: "subarea-1", subareaName: "Front desk", date: "2026-04-28", startTime: "09:00", endTime: "12:00", status: "published" as const }],
		});
		expect(risks).toEqual([expect.objectContaining({ id: "coverage:rule-1", severity: "high", title: "Front desk is understaffed" })]);
	});

	it("detects coverage risks for uncovered segments inside the rule window", () => {
		const risks = detectCoverageRisks({
			dayOfWeek: "tuesday",
			coverageRules: [{ id: "rule-1", subareaId: "subarea-1", subareaName: "Front desk", dayOfWeek: "tuesday", startTime: "09:00", endTime: "17:00", minimumStaffCount: 1 }],
			publishedShifts: [
				{ id: "shift-1", employeeId: "emp-1", employeeName: "Ada Lovelace", teamName: "Operations", subareaId: "subarea-1", subareaName: "Front desk", date: "2026-04-28", startTime: "09:00", endTime: "11:00", status: "published" as const },
				{ id: "shift-2", employeeId: "emp-2", employeeName: "Grace Hopper", teamName: "Operations", subareaId: "subarea-1", subareaName: "Front desk", date: "2026-04-28", startTime: "15:00", endTime: "17:00", status: "published" as const },
			],
		});

		expect(risks).toEqual([
			expect.objectContaining({ id: "coverage:rule-1", severity: "high", title: "Front desk is understaffed", description: "0 scheduled for 09:00-17:00; minimum is 1." }),
		]);
	});

	it("sorts action items by severity and stable title", () => {
		const items: BriefingActionItem[] = [
			{ id: "2", category: "payroll", severity: "warning", title: "B item", description: "", href: "/settings/payroll-readiness" },
			{ id: "1", category: "attendance", severity: "critical", title: "A item", description: "", href: "/time-tracking" },
			{ id: "3", category: "coverage", severity: "high", title: "C item", description: "", href: "/scheduling" },
		];
		expect(sortActionItems(items).map((item) => item.id)).toEqual(["1", "3", "2"]);
	});

	it("builds summary counts from normalized sections", () => {
		const item: BriefingActionItem = { id: "attendance:1", category: "attendance", severity: "critical", title: "Missing clock-in", description: "Ada has not clocked in", href: "/time-tracking" };
		expect(buildSummaryCounts({ needsAction: [item], approvals: [item], attendance: [item], absences: [], coverage: [], overtime: [], payroll: [item] })).toEqual({ criticalIssues: 1, openApprovals: 1, attendanceExceptions: 1, absencesToday: 0, coverageRisks: 0, overtimeWarnings: 0, payrollIssues: 1 });
	});
});
