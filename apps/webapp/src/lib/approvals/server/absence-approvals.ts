import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { syncCanonicalAbsenceApprovalState } from "@/app/[locale]/(app)/absences/actions.canonical";
import { absenceEntry, holiday } from "@/db/schema";
import { calculateBusinessDays } from "@/lib/absences/date-utils";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { EmailService } from "@/lib/effect/services/email.service";
import { renderAbsenceRequestApproved, renderAbsenceRequestRejected } from "@/lib/email/render";
import { onAbsenceRequestApproved, onAbsenceRequestRejected } from "@/lib/notifications/triggers";
import { addCalendarSyncJob } from "@/lib/queue";
import { processApproval } from "./shared";
import type { ApprovalDbService, CurrentApprover } from "./types";

interface AbsenceRecord {
	id: string;
	employeeId: string;
	organizationId: string;
	canonicalRecordId: string | null;
	startDate: string;
	endDate: string;
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

function ensureAbsenceRecord(absence: AbsenceRecord | null): Effect.Effect<AbsenceRecord, NotFoundError> {
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
	return dbService.query("updateAbsenceStatus", async () => {
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
	}).pipe(Effect.flatMap((absence) => ensureAbsenceRecord(absence as unknown as AbsenceRecord | null)));
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

function buildAbsenceEmailContext(absence: AbsenceRecord, currentEmployee: CurrentApprover, days: number) {
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

function notifyApprovedAbsence(absence: AbsenceRecord, entityId: string, currentEmployee: CurrentApprover) {
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
		const absence = yield* _(
			updateAbsenceStatus(dbService, entityId, currentEmployee, "approved"),
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
		const html = yield* _(
			Effect.promise(() => renderAbsenceRequestApproved(emailContext)),
		);

		yield* _(
			emailService.send({
				to: absence.employee.user.email,
				subject: `Absence Request Approved: ${absence.category.name}`,
				html,
			}),
		);

		notifyApprovedAbsence(absence, entityId, currentEmployee);
		return absence;
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
	return processApproval("absence_entry", absenceId, "approve", undefined, handleApprovedAbsence);
}

export async function rejectAbsenceEffect(
	absenceId: string,
	reason: string,
): Promise<ServerActionResult<void>> {
	return processApproval(
		"absence_entry",
		absenceId,
		"reject",
		reason,
		(dbService, entityId, currentEmployee) =>
			handleRejectedAbsence(dbService, entityId, currentEmployee, reason),
	);
}
