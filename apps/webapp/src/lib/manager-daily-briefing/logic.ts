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

type BriefingParams = Record<string, string | number>;

// Item copy as ICU templates. Each key sits next to its English template, so the Tolgee
// extractor reads the template as the key's default. `formatBriefingText` renders the English
// title and description that items carry for sorting and as the translation fallback.
const briefingItemText = {
	notClockedIn: {
		titleKey: "today.briefing.items.attendance.notClockedIn.title",
		title: "{employeeName} has not clocked in",
		descriptionKey: "today.briefing.items.attendance.notClockedIn.description",
		description: "{employeeName} was scheduled to start at {startTime}{teamSuffix}.",
	},
	clockedInLate: {
		titleKey: "today.briefing.items.attendance.clockedInLate.title",
		title: "{employeeName} clocked in late",
		descriptionKey: "today.briefing.items.attendance.clockedInLate.description",
		description:
			"{employeeName} was scheduled to start at {startTime} and clocked in at {clockInTime}{teamSuffix}.",
	},
	absent: {
		titleKey: "today.briefing.items.absence.isAbsent.title",
		title: "{employeeName} is absent",
		descriptionKey: "today.briefing.items.absence.isAbsent.description",
		description: "{categoryName}{teamSuffix}.",
	},
	understaffed: {
		titleKey: "today.briefing.items.coverage.understaffed.title",
		title: "{subareaName} is understaffed",
		descriptionKey: "today.briefing.items.coverage.understaffed.description",
		description:
			"{scheduledStaffCount} scheduled for {startTime}-{endTime}; minimum is {minimumStaffCount}.",
	},
} as const;

function formatBriefingText(template: string, params: BriefingParams): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in params ? String(params[name]) : match,
	);
}

function briefingItemCopy(
	text: (typeof briefingItemText)[keyof typeof briefingItemText],
	titleParams: BriefingParams,
	descriptionParams: BriefingParams,
): Pick<
	BriefingActionItem,
	"title" | "titleKey" | "titleParams" | "description" | "descriptionKey" | "descriptionParams"
> {
	return {
		title: formatBriefingText(text.title, titleParams),
		titleKey: text.titleKey,
		titleParams,
		description: formatBriefingText(text.description, descriptionParams),
		descriptionKey: text.descriptionKey,
		descriptionParams,
	};
}

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
		const firstClockIn = records.reduce<DateTime | null>((earliest, record) => {
				if (record.employeeId !== shift.employeeId) return earliest;
				const startAt = DateTime.fromJSDate(record.startAt).setZone(now.zone);
				const endAt = record.endAt ? DateTime.fromJSDate(record.endAt).setZone(now.zone) : null;

				const matchesShift =
					startAt >= associationStart &&
					startAt < scheduledEnd &&
					(endAt === null || endAt > scheduledStart);

				if (!matchesShift) return earliest;

				return !earliest || startAt.toMillis() < earliest.toMillis() ? startAt : earliest;
			}, null);

		if (!firstClockIn) {
			if (now < scheduledStart.plus({ minutes: graceMinutes })) {
				return [];
			}

			return [
				{
					id: `attendance:${shift.id}`,
					category: "attendance",
					severity: "critical",
					...briefingItemCopy(
						briefingItemText.notClockedIn,
						{ employeeName: shift.employeeName },
						{
							employeeName: shift.employeeName,
							startTime: shift.startTime,
							teamSuffix: formatTeamSuffix(shift.teamName),
						},
					),
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
					...briefingItemCopy(
						briefingItemText.clockedInLate,
						{ employeeName: shift.employeeName },
						{
							employeeName: shift.employeeName,
							startTime: shift.startTime,
							clockInTime: firstClockIn.toFormat("HH:mm"),
							teamSuffix: formatTeamSuffix(shift.teamName),
						},
					),
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
					...briefingItemCopy(
						briefingItemText.absent,
						{ employeeName: absence.employeeName },
						{
							categoryName: absence.categoryName,
							teamSuffix: formatTeamSuffix(absence.teamName),
						},
					),
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
					...briefingItemCopy(
						briefingItemText.understaffed,
						{ subareaName: rule.subareaName },
						{
							scheduledStaffCount,
							startTime: rule.startTime,
							endTime: rule.endTime,
							minimumStaffCount: rule.minimumStaffCount,
						},
					),
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
