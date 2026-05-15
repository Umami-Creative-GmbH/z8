import { validateSickDetailForCategory } from "@/lib/absences/sick-details";
import type { VacationOverrideSummary } from "@/lib/absences/sick-vacation-override";
import type { AbsenceRequest } from "@/lib/absences/types";
import { ValidationError } from "@/lib/effect/errors";
import { addCalendarSyncJob } from "@/lib/queue";

export function validateAbsenceSickDetail(input: {
	categoryType: string;
	sickDetail?: AbsenceRequest["sickDetail"] | null;
}): string | null {
	return validateSickDetailForCategory(input);
}

export function createSickDetailValidationError(message: string): ValidationError {
	return new ValidationError({
		message,
		field: "sickDetail",
		value: "[redacted]",
	});
}

export function enqueueVacationOverrideCalendarSyncJobs(input: {
	employeeId: string;
	summary: VacationOverrideSummary;
}) {
	for (const absenceId of input.summary.updatedAbsenceIds) {
		void addCalendarSyncJob({ absenceId, employeeId: input.employeeId, action: "update" });
	}

	for (const absenceId of input.summary.createdAbsenceIds) {
		void addCalendarSyncJob({ absenceId, employeeId: input.employeeId, action: "create" });
	}

	for (const absenceId of input.summary.deletedAbsenceIds) {
		void addCalendarSyncJob({ absenceId, employeeId: input.employeeId, action: "delete" });
	}
}
