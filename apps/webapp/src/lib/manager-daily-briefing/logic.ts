import { DateTime } from "luxon";
import type {
	BriefingAbsence,
	BriefingActionItem,
	BriefingCoverageRule,
	BriefingSections,
	BriefingShift,
	BriefingSummaryCounts,
	BriefingTimeRecord,
} from "./types";

const severityRank: Record<BriefingActionItem["severity"], number> = {
	critical: 0,
	high: 1,
	warning: 2,
	info: 3,
};

export function sortActionItems(items: BriefingActionItem[]): BriefingActionItem[] {
	return [...items].sort((left, right) => {
		const severityDiff = severityRank[left.severity] - severityRank[right.severity];

		if (severityDiff !== 0) {
			return severityDiff;
		}

		return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
	});
}

interface DetectAttendanceExceptionsInput {
	now: DateTime;
	shifts: BriefingShift[];
	records: BriefingTimeRecord[];
	graceMinutes: number;
}

export function detectAttendanceExceptions({
	now,
	shifts,
	records,
	graceMinutes,
}: DetectAttendanceExceptionsInput): BriefingActionItem[] {
	const items = shifts.flatMap((shift): BriefingActionItem[] => {
		if (shift.status !== "published") {
			return [];
		}

		const scheduledStart = DateTime.fromISO(`${shift.date}T${shift.startTime}`, { zone: now.zone });
		const openRecord = records.find((record) => {
			const startAt = DateTime.fromJSDate(record.startAt).setZone(now.zone);

			return record.employeeId === shift.employeeId && record.endAt === null && startAt.toISODate() === shift.date;
		});

		if (!openRecord) {
			if (now < scheduledStart.plus({ minutes: graceMinutes })) {
				return [];
			}

			return [
				{
					id: `attendance:${shift.id}`,
					category: "attendance",
					severity: "critical",
					title: `${shift.employeeName} has not clocked in`,
					description: `${shift.employeeName} was scheduled to start at ${shift.startTime}${formatTeamSuffix(shift.teamName)}.`,
					href: "/time-tracking",
				},
			];
		}

		return [];
	});

	return sortActionItems(items);
}

interface DetectAbsencesTodayInput {
	today: DateTime;
	absences: BriefingAbsence[];
}

export function detectAbsencesToday({ today, absences }: DetectAbsencesTodayInput): BriefingActionItem[] {
	const todayDate = today.toISODate();

	if (!todayDate) {
		return [];
	}

	return sortActionItems(
		absences.flatMap((absence): BriefingActionItem[] => {
			if (absence.status !== "approved" || absence.startDate > todayDate || absence.endDate < todayDate) {
				return [];
			}

			return [
				{
					id: `absence:${absence.id}`,
					category: "absence",
					severity: "info",
					title: `${absence.employeeName} is absent`,
					description: `${absence.categoryName}${formatTeamSuffix(absence.teamName)}.`,
					href: "/absences",
				},
			];
		}),
	);
}

interface DetectCoverageRisksInput {
	dayOfWeek: string;
	coverageRules: BriefingCoverageRule[];
	publishedShifts: BriefingShift[];
}

export function detectCoverageRisks({
	dayOfWeek,
	coverageRules,
	publishedShifts,
}: DetectCoverageRisksInput): BriefingActionItem[] {
	return sortActionItems(
		coverageRules.flatMap((rule): BriefingActionItem[] => {
			if (rule.dayOfWeek !== dayOfWeek) {
				return [];
			}

			const scheduledStaffCount = publishedShifts.filter(
				(shift) =>
					shift.status === "published" &&
					shift.subareaId === rule.subareaId &&
					timeRangesOverlap(shift.startTime, shift.endTime, rule.startTime, rule.endTime),
			).length;

			if (scheduledStaffCount >= rule.minimumStaffCount) {
				return [];
			}

			return [
				{
					id: `coverage:${rule.id}`,
					category: "coverage",
					severity: "high",
					title: `${rule.subareaName} is understaffed`,
					description: `${scheduledStaffCount} scheduled for ${rule.startTime}-${rule.endTime}; minimum is ${rule.minimumStaffCount}.`,
					href: "/scheduling",
				},
			];
		}),
	);
}

export function buildSummaryCounts(sections: BriefingSections): BriefingSummaryCounts {
	return {
		criticalIssues: sections.needsAction.filter((item) => item.severity === "critical").length,
		openApprovals: sections.approvals.length,
		attendanceExceptions: sections.attendance.length,
		absencesToday: sections.absences.length,
		coverageRisks: sections.coverage.length,
		overtimeWarnings: sections.overtime.length,
		payrollIssues: sections.payroll.length,
	};
}

function formatTeamSuffix(teamName: string | null): string {
	return teamName ? ` (${teamName})` : "";
}

function timeRangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
	return timeToMinutes(leftStart) < timeToMinutes(rightEnd) && timeToMinutes(leftEnd) > timeToMinutes(rightStart);
}

function timeToMinutes(time: string): number {
	const [hours = "0", minutes = "0"] = time.split(":");

	return Number(hours) * 60 + Number(minutes);
}
