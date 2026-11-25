import type { useTranslate } from "@tolgee/react";
import type { WorkingStudentFindingView } from "@/lib/statutory/working-student/views";

// Working-student monitor texts and formatting: the Employee Detail card and Reviews & Conflicts.

type Translate = ReturnType<typeof useTranslate>["t"];

export function hours(minutes: number, locale: string): string {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
}

export function workingStudentFindingText(
	finding: WorkingStudentFindingView,
	t: Translate,
	locale: string,
) {
	const { used, limit } = finding.summary;
	if (finding.kind === "working_student_lecture_week" && used && limit) {
		return t(
			"settings.contracts.workingStudent.finding.lectureWeek",
			"{hours} h of weekday daytime work in a lecture week (limit {limit} h)",
			{ hours: hours(used.value, locale), limit: hours(limit.value, locale) },
		);
	}
	if (finding.kind === "working_student_26_week_ceiling" && used && limit) {
		return t(
			"settings.contracts.workingStudent.finding.ceiling",
			"{used} of {limit} weeks above 20 h in the last 12 months",
			{ used: used.value, limit: limit.value },
		);
	}
	return t("settings.contracts.workingStudent.finding.generic", "Working-student limit at risk");
}
