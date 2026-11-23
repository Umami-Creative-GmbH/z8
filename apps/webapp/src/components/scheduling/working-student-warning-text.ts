import type { useTranslate } from "@tolgee/react";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

type Translate = ReturnType<typeof useTranslate>["t"];

function hours(minutes: number): string {
	return String(Math.round((minutes / 60) * 10) / 10);
}

/**
 * Planner text for working-student findings (#1991), or null for other findings. Uses only the
 * wage-free summary: lecture-week minutes and rolling week counts.
 */
export function workingStudentWarningText(
	finding: StatutoryComplianceFinding,
	t: Translate,
): string | null {
	const { used, limit } = finding.summary;
	switch (finding.statutoryKind) {
		case "working_student_lecture_week":
			if (used?.unit !== "minutes" || limit?.unit !== "minutes") return null;
			return t(
				"scheduling:scheduling.statutory.workingStudent.lectureWeek",
				"Working student >20 h in lecture week: {hours} h of weekday daytime work (limit {limit} h)",
				{ hours: hours(used.value), limit: hours(limit.value) },
			);
		case "working_student_26_week_ceiling":
			if (used?.unit !== "weeks" || limit?.unit !== "weeks") return null;
			return t(
				"scheduling:scheduling.statutory.workingStudent.ceiling",
				"Working student: {used} of {limit} weeks above 20 h in 12 months",
				{ used: used.value, limit: limit.value },
			);
		default:
			return null;
	}
}
