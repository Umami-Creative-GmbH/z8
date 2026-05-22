import { validateSickDetailForCategory } from "@/lib/absences/sick-details";
import type { VacationOverrideSummary } from "@/lib/absences/sick-vacation-override";
import type { AbsenceRequest, DayPeriod } from "@/lib/absences/types";
import { ValidationError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { addCalendarSyncJob } from "@/lib/queue";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";

const logger = createLogger("AbsenceActionsEffect");

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

export function shouldApplySickVacationOverrideImmediately(input: {
	categoryType: string;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
	requiresApproval: boolean;
	hasManagerApprovalWorkflow: boolean;
}): boolean {
	return (
		input.categoryType === "sick" &&
		input.startPeriod === "full_day" &&
		input.endPeriod === "full_day" &&
		!(input.requiresApproval && input.hasManagerApprovalWorkflow)
	);
}

export function selectAbsenceDefaultApproverId(input: {
	legacyManagerId: string | null;
	eligibleManagerIds: string[];
}): string | null {
	return input.eligibleManagerIds[0] ?? input.legacyManagerId;
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

export async function markAutoApprovedAbsenceWorkBalanceDirtyBestEffort(input: {
	employeeId: string;
	organizationId: string;
	absenceId: string;
	startDate: string;
}) {
	try {
		await markEmployeeWorkBalanceDirty({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			dirtyFromDate: input.startDate,
		});
	} catch (error) {
		logger.error(
			{
				error,
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				absenceId: input.absenceId,
			},
			"Failed to mark work balance dirty after auto-approved absence",
		);
	}
}
