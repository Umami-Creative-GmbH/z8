import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { syncCanonicalAbsenceApprovalState } from "@/app/[locale]/(app)/absences/actions.canonical";
import { enqueueVacationOverrideCalendarSyncJobs } from "@/app/[locale]/(app)/absences/request-absence-effect-helpers";
import { absenceEntry, approvalRequest, holiday } from "@/db/schema";
import { calculateBusinessDays } from "@/lib/absences/date-utils";
import { adjustVacationAbsencesForSickness } from "@/lib/absences/sick-vacation-override";
import type { VacationOverrideSummary } from "@/lib/absences/sick-vacation-override";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AnyAppError, NotFoundError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { EmailService } from "@/lib/effect/services/email.service";
import { renderAbsenceRequestApproved, renderAbsenceRequestRejected } from "@/lib/email/render";
import { onAbsenceRequestApproved, onAbsenceRequestRejected } from "@/lib/notifications/triggers";
import { addCalendarSyncJob } from "@/lib/queue";
import type { ApprovalActionOptions } from "../domain/types";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import type { ApprovalPolicyEvaluationContext } from "../policies/types";
import { processApproval, processApprovalWithCurrentEmployee } from "./shared";
import type { ApprovalDbService, CurrentApprover } from "./types";

interface AbsenceRecord {
	id: string;
	employeeId: string;
	organizationId: string;
	canonicalRecordId: string | null;
	startDate: string;
	startPeriod: "full_day" | "am" | "pm";
	endDate: string;
	endPeriod: "full_day" | "am" | "pm";
	status: string;
	rejectionReason: string | null;
	category: {
		name: string;
		type: string;
		color: string | null;
	};
	employee: {
		userId: string;
		organizationId: string;
		user: {
			name: string;
			email: string;
			image: string | null;
		};
	};
}

type ApprovedAbsenceResult = {
	absence: AbsenceRecord;
	vacationOverrideSummary: VacationOverrideSummary;
};

const emptyVacationOverrideSummary = (): VacationOverrideSummary => ({
	updatedAbsenceIds: [],
	createdAbsenceIds: [],
	deletedAbsenceIds: [],
});

async function applySickVacationOverrideOnApproval(
	dbService: ApprovalDbService,
	absence: AbsenceRecord,
	currentEmployee: CurrentApprover,
): Promise<VacationOverrideSummary> {
	if (
		absence.category.type !== "sick" ||
		absence.startPeriod !== "full_day" ||
		absence.endPeriod !== "full_day"
	) {
		return emptyVacationOverrideSummary();
	}

	return await adjustVacationAbsencesForSickness({
		tx: dbService.db,
		organizationId: absence.organizationId,
		employeeId: absence.employeeId,
		sickStartDate: absence.startDate,
		sickEndDate: absence.endDate,
		updatedBy: currentEmployee.user.id,
	});
}

function ensureAbsenceRecord(
	absence: AbsenceRecord | null,
): Effect.Effect<AbsenceRecord, NotFoundError> {
	return absence
		? Effect.succeed(absence)
		: Effect.fail(
				new NotFoundError({
					message: "Absence not found",
					entityType: "absence_entry",
				}),
			);
}

function updateAbsenceStatus(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	status: "approved" | "rejected",
	reason?: string,
) {
	return dbService
		.query("updateAbsenceStatus", async () => {
			await dbService.db
				.update(absenceEntry)
				.set({
					status,
					approvedAt: status === "approved" ? currentTimestamp() : undefined,
					approvedBy: status === "approved" ? currentEmployee.id : undefined,
					rejectionReason: status === "rejected" ? reason : undefined,
				})
				.where(eq(absenceEntry.id, entityId));

			return await dbService.db.query.absenceEntry.findFirst({
				where: eq(absenceEntry.id, entityId),
				with: {
					category: true,
					employee: { with: { user: true } },
				},
			});
		})
		.pipe(
			Effect.flatMap((absence) => ensureAbsenceRecord(absence as unknown as AbsenceRecord | null)),
		);
}

function loadHolidays(dbService: ApprovalDbService, organizationId: string) {
	return dbService.query("getHolidays", async () => {
		return await dbService.db.query.holiday.findMany({
			where: eq(holiday.organizationId, organizationId),
		});
	});
}

export function formatAbsenceDateForEmail(date: Date | string) {
	const value = typeof date === "string" ? DateTime.fromISO(date) : DateTime.fromJSDate(date);
	return value.toFormat("LLL d, yyyy");
}

export function buildAbsenceApprovalPolicyContext(absence: {
	id: string;
	organizationId: string;
	employeeId: string;
	categoryId: string | null;
	employee: { teamId: string | null };
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: absence.organizationId,
		approvalType: "absence_entry",
		requesterEmployeeId: absence.employeeId,
		teamId: absence.employee.teamId,
		locationId: null,
		absenceCategoryId: absence.categoryId,
		travelExpenseAmount: null,
		overtimeRisk: null,
		employeeGroupIds: [],
		entityType: "absence_entry",
		entityId: absence.id,
	};
}

export function createAbsenceApprovalWorkflow(
	dbService: ApprovalDbService,
	input: {
		absence: Parameters<typeof buildAbsenceApprovalPolicyContext>[0];
		defaultApproverId: string;
	},
): Effect.Effect<ResolvePolicyAndCreateApprovalResult, AnyAppError, never> {
	return resolvePolicyAndCreateApproval(dbService, {
		context: buildAbsenceApprovalPolicyContext(input.absence),
		defaultApproverId: input.defaultApproverId,
	}).pipe(
		Effect.catchTag("ValidationError", () =>
			dbService.query("createDefaultAbsenceApprovalFallback", async () => {
				const [approval] = await dbService.db
					.insert(approvalRequest)
					.values({
						organizationId: input.absence.organizationId,
						entityType: "absence_entry",
						entityId: input.absence.id,
						requestedBy: input.absence.employeeId,
						approverId: input.defaultApproverId,
						status: "pending",
					})
					.returning({ id: approvalRequest.id });

				return { kind: "default_created" as const, approvalRequestId: approval?.id ?? input.absence.id };
			}),
		),
	);
}

export function approveAbsenceWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	absenceId: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"absence_entry",
		absenceId,
		"approve",
		undefined,
		handleApprovedAbsence,
		undefined,
		{ ...options, transactional: true },
	).pipe(
		Effect.tap((result) =>
			result
				? Effect.sync(() =>
						enqueueVacationOverrideCalendarSyncJobs({
							employeeId: result.absence.employeeId,
							summary: result.vacationOverrideSummary,
						}),
					)
				: Effect.void,
		),
	);
}

export function rejectAbsenceWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	absenceId: string,
	reason: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"absence_entry",
		absenceId,
		"reject",
		reason,
		(decisionDbService, entityId, approver) =>
			handleRejectedAbsence(decisionDbService, entityId, approver, reason),
		undefined,
		{ ...options, transactional: true },
	);
}

function buildAbsenceEmailContext(
	absence: AbsenceRecord,
	currentEmployee: CurrentApprover,
	days: number,
) {
	return Effect.gen(function* (_) {
		const appUrl = yield* _(
			Effect.promise(() => getOrganizationBaseUrl(absence.employee.organizationId)),
		);

		return {
			employeeName: absence.employee.user.name,
			approverName: currentEmployee.user.name,
			startDate: formatAbsenceDateForEmail(absence.startDate),
			endDate: formatAbsenceDateForEmail(absence.endDate),
			absenceType: absence.category.name,
			days,
			appUrl,
		};
	});
}

function notifyApprovedAbsence(
	absence: AbsenceRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
) {
	void onAbsenceRequestApproved({
		absenceId: entityId,
		employeeUserId: absence.employee.userId,
		employeeName: absence.employee.user.name,
		organizationId: absence.employee.organizationId,
		categoryName: absence.category.name,
		startDate: absence.startDate,
		endDate: absence.endDate,
		approverName: currentEmployee.user.name,
	});

	void addCalendarSyncJob({
		absenceId: entityId,
		employeeId: absence.employeeId,
		action: "create",
	});
}

function notifyRejectedAbsence(
	absence: AbsenceRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
) {
	void onAbsenceRequestRejected({
		absenceId: entityId,
		employeeUserId: absence.employee.userId,
		employeeName: absence.employee.user.name,
		organizationId: absence.employee.organizationId,
		categoryName: absence.category.name,
		startDate: absence.startDate,
		endDate: absence.endDate,
		approverName: currentEmployee.user.name,
		rejectionReason: reason,
	});
}

function handleApprovedAbsence(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
) {
	return Effect.gen(function* (_) {
		const emailService = yield* _(EmailService);
		const absence = yield* _(updateAbsenceStatus(dbService, entityId, currentEmployee, "approved"));
		const vacationOverrideSummary = yield* _(
			Effect.promise(() => applySickVacationOverrideOnApproval(dbService, absence, currentEmployee)),
		);
		yield* _(
			Effect.promise(() =>
				syncCanonicalAbsenceApprovalState({
					organizationId: absence.organizationId,
					canonicalRecordId: absence.canonicalRecordId,
					approvalState: "approved",
					updatedBy: currentEmployee.user.id,
				}),
			),
		);
		const holidays = yield* _(loadHolidays(dbService, absence.employee.organizationId));
		const days = calculateBusinessDays(
			new Date(absence.startDate),
			new Date(absence.endDate),
			holidays,
		);
		const emailContext = yield* _(buildAbsenceEmailContext(absence, currentEmployee, days));
		const html = yield* _(Effect.promise(() => renderAbsenceRequestApproved(emailContext)));

		yield* _(
			emailService.send({
				to: absence.employee.user.email,
				subject: `Absence Request Approved: ${absence.category.name}`,
				html,
			}),
		);

		notifyApprovedAbsence(absence, entityId, currentEmployee);
		return { absence, vacationOverrideSummary };
	});
}

function handleRejectedAbsence(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
) {
	return Effect.gen(function* (_) {
		const emailService = yield* _(EmailService);
		const absence = yield* _(
			updateAbsenceStatus(dbService, entityId, currentEmployee, "rejected", reason),
		);
		yield* _(
			Effect.promise(() =>
				syncCanonicalAbsenceApprovalState({
					organizationId: absence.organizationId,
					canonicalRecordId: absence.canonicalRecordId,
					approvalState: "rejected",
					updatedBy: currentEmployee.user.id,
				}),
			),
		);
		const holidays = yield* _(loadHolidays(dbService, absence.employee.organizationId));
		const days = calculateBusinessDays(
			new Date(absence.startDate),
			new Date(absence.endDate),
			holidays,
		);
		const emailContext = yield* _(buildAbsenceEmailContext(absence, currentEmployee, days));
		const html = yield* _(
			Effect.promise(() =>
				renderAbsenceRequestRejected({
					...emailContext,
					rejectionReason: reason,
				}),
			),
		);

		yield* _(
			emailService.send({
				to: absence.employee.user.email,
				subject: `Absence Request Rejected: ${absence.category.name}`,
				html,
			}),
		);

		notifyRejectedAbsence(absence, entityId, currentEmployee, reason);
		return absence;
	});
}

export async function approveAbsenceEffect(absenceId: string): Promise<ServerActionResult<void>> {
	const result = await processApproval(
		"absence_entry",
		absenceId,
		"approve",
		undefined,
		handleApprovedAbsence,
		undefined,
		{ transactional: true },
	);
	if (!result) return { success: true, data: undefined };
	if (result.success && result.data) {
		enqueueVacationOverrideCalendarSyncJobs({
			employeeId: result.data.absence.employeeId,
			summary: result.data.vacationOverrideSummary,
		});
	}
	return result.success ? { success: true, data: undefined } : result;
}

export async function rejectAbsenceEffect(
	absenceId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	const result = await processApproval(
		"absence_entry",
		absenceId,
		"reject",
		reason,
		(dbService, entityId, currentEmployee) =>
			handleRejectedAbsence(dbService, entityId, currentEmployee, reason),
		undefined,
		{ transactional: true },
	);

	if (!result) return { success: true, data: undefined };
	return result.success ? { success: true, data: undefined } : result;
}
