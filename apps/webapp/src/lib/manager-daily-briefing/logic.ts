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

const briefingCopy = {
	notClockedInTitle: (employeeName: string) => `${employeeName} has not clocked in`,
	clockedInLateTitle: (employeeName: string) => `${employeeName} clocked in late`,
	absentTitle: (employeeName: string) => `${employeeName} is absent`,
	understaffedTitle: (subareaName: string) => `${subareaName} is understaffed`,
};

export function sortActionItems(items: BriefingActionItem[]): BriefingActionItem[] {
	return items.toSorted((left, right) => {
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
		const scheduledEnd = getShiftEnd(scheduledStart, shift.endTime);
		const associationStart = scheduledStart.minus({ hours: 2 });
		const firstClockIn = records
			.flatMap((record) => {
				if (record.employeeId !== shift.employeeId) return [];
				const startAt = DateTime.fromJSDate(record.startAt).setZone(now.zone);
				const endAt = record.endAt ? DateTime.fromJSDate(record.endAt).setZone(now.zone) : null;

				return startAt >= associationStart &&
					startAt < scheduledEnd &&
					(endAt === null || endAt > scheduledStart)
					? [startAt]
					: [];
			})
			.sort((left, right) => left.toMillis() - right.toMillis())[0];

		if (!firstClockIn) {
			if (now < scheduledStart.plus({ minutes: graceMinutes })) {
				return [];
			}

			return [
				{
					id: `attendance:${shift.id}`,
					category: "attendance",
					severity: "critical",
					title: briefingCopy.notClockedInTitle(shift.employeeName),
					titleKey: "today.briefing.items.attendance.notClockedIn.title",
					titleParams: { employeeName: shift.employeeName },
					description: `${shift.employeeName} was scheduled to start at ${shift.startTime}${formatTeamSuffix(shift.teamName)}.`,
					descriptionKey: "today.briefing.items.attendance.notClockedIn.description",
					descriptionParams: {
						employeeName: shift.employeeName,
						startTime: shift.startTime,
						teamSuffix: formatTeamSuffix(shift.teamName),
					},
					href: "/time-tracking",
				},
			];
		}

		if (firstClockIn > scheduledStart.plus({ minutes: graceMinutes })) {
			return [
				{
					id: `attendance:${shift.id}`,
					category: "attendance",
					severity: "high",
					title: briefingCopy.clockedInLateTitle(shift.employeeName),
					titleKey: "today.briefing.items.attendance.clockedInLate.title",
					titleParams: { employeeName: shift.employeeName },
					description: `${shift.employeeName} was scheduled to start at ${shift.startTime} and clocked in at ${firstClockIn.toFormat("HH:mm")}${formatTeamSuffix(shift.teamName)}.`,
					descriptionKey: "today.briefing.items.attendance.clockedInLate.description",
					descriptionParams: {
						employeeName: shift.employeeName,
						startTime: shift.startTime,
						clockInTime: firstClockIn.toFormat("HH:mm"),
						teamSuffix: formatTeamSuffix(shift.teamName),
					},
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

export function detectAbsencesToday({
	today,
	absences,
}: DetectAbsencesTodayInput): BriefingActionItem[] {
	const todayDate = today.toISODate();

	if (!todayDate) {
		return [];
	}

	return sortActionItems(
		absences.flatMap((absence): BriefingActionItem[] => {
			if (
				absence.status !== "approved" ||
				absence.startDate > todayDate ||
				absence.endDate < todayDate
			) {
				return [];
			}

			return [
				{
					id: `absence:${absence.id}`,
					category: "absence",
					severity: "info",
					title: briefingCopy.absentTitle(absence.employeeName),
					titleKey: "today.briefing.items.absence.isAbsent.title",
					titleParams: { employeeName: absence.employeeName },
					description: `${absence.categoryName}${formatTeamSuffix(absence.teamName)}.`,
					descriptionKey: "today.briefing.items.absence.isAbsent.description",
					descriptionParams: {
						categoryName: absence.categoryName,
						teamSuffix: formatTeamSuffix(absence.teamName),
					},
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

			const scheduledStaffCount = getLowestStaffedSegmentCount(rule, publishedShifts);

			if (scheduledStaffCount >= rule.minimumStaffCount) {
				return [];
			}

			return [
				{
					id: `coverage:${rule.id}`,
					category: "coverage",
					severity: "high",
					title: briefingCopy.understaffedTitle(rule.subareaName),
					titleKey: "today.briefing.items.coverage.understaffed.title",
					titleParams: { subareaName: rule.subareaName },
					description: `${scheduledStaffCount} scheduled for ${rule.startTime}-${rule.endTime}; minimum is ${rule.minimumStaffCount}.`,
					descriptionKey: "today.briefing.items.coverage.understaffed.description",
					descriptionParams: {
						scheduledStaffCount,
						startTime: rule.startTime,
						endTime: rule.endTime,
						minimumStaffCount: rule.minimumStaffCount,
					},
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

function getShiftEnd(scheduledStart: DateTime, endTime: string): DateTime {
	const scheduledEnd = DateTime.fromISO(`${scheduledStart.toISODate()}T${endTime}`, {
		zone: scheduledStart.zone,
	});

	return scheduledEnd <= scheduledStart ? scheduledEnd.plus({ days: 1 }) : scheduledEnd;
}

function getLowestStaffedSegmentCount(rule: BriefingCoverageRule, shifts: BriefingShift[]): number {
	const ruleStart = timeToMinutes(rule.startTime);
	const ruleEnd = timeToMinutes(rule.endTime);
	const assignedShifts = shifts.filter((shift) => {
		const shiftStart = timeToMinutes(shift.startTime);
		const shiftEnd = timeToMinutes(shift.endTime);

		return (
			shift.status === "published" &&
			shift.subareaId === rule.subareaId &&
			shiftStart < ruleEnd &&
			shiftEnd > ruleStart
		);
	});

	const boundaries = new Set([ruleStart, ruleEnd]);

	for (const shift of assignedShifts) {
		const shiftStart = timeToMinutes(shift.startTime);
		const shiftEnd = timeToMinutes(shift.endTime);

		if (shiftStart > ruleStart && shiftStart < ruleEnd) {
			boundaries.add(shiftStart);
		}

		if (shiftEnd > ruleStart && shiftEnd < ruleEnd) {
			boundaries.add(shiftEnd);
		}
	}

	const orderedBoundaries = Array.from(boundaries).toSorted((left, right) => left - right);
	let lowestStaffCount = Number.POSITIVE_INFINITY;

	for (let index = 0; index < orderedBoundaries.length - 1; index++) {
		const segmentStart = orderedBoundaries[index];
		const segmentEnd = orderedBoundaries[index + 1];

		if (segmentStart === undefined || segmentEnd === undefined || segmentStart === segmentEnd) {
			continue;
		}

		const segmentStaffCount = new Set(
			assignedShifts.flatMap((shift) => {
				const shiftStart = timeToMinutes(shift.startTime);
				const shiftEnd = timeToMinutes(shift.endTime);

				return shiftStart <= segmentStart && shiftEnd >= segmentEnd ? [shift.employeeId] : [];
			}),
		).size;

		lowestStaffCount = Math.min(lowestStaffCount, segmentStaffCount);
	}

	return lowestStaffCount === Number.POSITIVE_INFINITY ? 0 : lowestStaffCount;
}

function timeToMinutes(time: string): number {
	const [hours = "0", minutes = "0"] = time.split(":");

	return Number(hours) * 60 + Number(minutes);
}
