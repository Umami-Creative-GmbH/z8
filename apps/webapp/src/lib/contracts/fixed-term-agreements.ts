import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
	contractMigrationConflict,
	type EmploymentTermAgreement,
	employeeDeparture,
	employeeDepartureTask,
	employeeEmploymentPeriod,
	employmentTermAgreement,
} from "@/db/schema";
import type { EmploymentTermAgreementKind } from "@/db/schema/contract-types";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { departureCutoff } from "@/lib/employee-lifecycle/cutoff";
import { queueDataExportReminder } from "@/lib/employee-lifecycle/data-export-reminder";
import { resolveCurrentEmploymentPeriod } from "@/lib/employee-lifecycle/employment-periods";
import { lockEmployeeRow } from "@/lib/employee-lifecycle/locks";
import { requestFingerprint, writeReceipt } from "@/lib/employee-lifecycle/receipts";
import { synchronizeEquipmentDeparture } from "@/lib/organization/equipment/lifecycle";
import { type ContractWriteTx, parseIsoCalendarDate } from "./contract-validation";

export type FixedTermDepartureSyncAction =
	| "update_leaving_date"
	| "cancel_departure"
	| "leave_unchanged";

export interface CreateInitialEmploymentAgreementInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly actorUserId: string;
	readonly employmentPeriodId?: string | null;
	readonly kind: EmploymentTermAgreementKind;
	readonly startsOn: string;
	readonly endsOn?: string | null;
	readonly reason?: string | null;
	readonly notes?: string | null;
}

export interface RecordFixedTermExtensionInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly actorUserId: string;
	readonly employmentPeriodId?: string | null;
	readonly kind: EmploymentTermAgreementKind;
	readonly startsOn: string;
	readonly endsOn?: string | null;
	readonly reason?: string | null;
	readonly notes?: string | null;
	readonly departureSyncAction: FixedTermDepartureSyncAction;
	readonly now?: Instant;
}

export type FixedTermDepartureSyncResult =
	| { readonly status: "no_pending_departure" }
	| {
			readonly status: "updated";
			readonly departureId: string;
			readonly previousLastWorkingDay: string | null;
			readonly newLastWorkingDay: string;
			readonly newRevision: number;
	  }
	| {
			readonly status: "canceled";
			readonly departureId: string;
			readonly newRevision: number;
	  }
	| {
			readonly status: "left_unchanged";
			readonly flaggedForReview: true;
			readonly departureId: string;
			readonly pendingLastWorkingDay: string | null;
			readonly reviewConflictId: string | null;
	  };

export interface RecordFixedTermExtensionResult {
	readonly agreement: EmploymentTermAgreement;
	readonly previousAgreementId: string;
	readonly departureSync: FixedTermDepartureSyncResult;
}

function validateAgreementFields(input: {
	kind: EmploymentTermAgreementKind;
	startsOn: string;
	endsOn?: string | null;
	reason?: string | null;
}) {
	const startsOn = parseIsoCalendarDate(input.startsOn, "startsOn");
	const endsOn =
		input.endsOn !== null && input.endsOn !== undefined && input.endsOn !== ""
			? parseIsoCalendarDate(input.endsOn, "endsOn")
			: null;
	const reason = input.reason?.trim() ? input.reason.trim() : null;

	if (input.kind === "permanent") {
		if (endsOn !== null) {
			throw new ValidationError({
				message: "Permanent employment agreements cannot specify an end date.",
				field: "endsOn",
				refusal: "permanent_agreement_forbids_end_date",
			});
		}
		if (reason !== null) {
			throw new ValidationError({
				message: "Permanent employment agreements cannot specify a fixed-term reason.",
				field: "reason",
				refusal: "permanent_agreement_forbids_reason",
			});
		}
	} else {
		if (endsOn === null) {
			throw new ValidationError({
				message: "Fixed-term employment agreements require an end date.",
				field: "endsOn",
				refusal: "fixed_term_requires_end_date",
			});
		}
		if (endsOn < startsOn) {
			throw new ValidationError({
				message: "Fixed-term end date must be on or after the start date.",
				field: "endsOn",
				refusal: "fixed_term_end_before_start",
			});
		}
	}

	return { kind: input.kind, startsOn, endsOn, reason };
}

async function resolveTargetEmploymentPeriodIdInTx(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId?: string | null;
	},
): Promise<string> {
	if (input.employmentPeriodId) {
		const [period] = await tx
			.select({ id: employeeEmploymentPeriod.id, status: employeeEmploymentPeriod.status })
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.id, input.employmentPeriodId),
					eq(employeeEmploymentPeriod.organizationId, input.organizationId),
					eq(employeeEmploymentPeriod.employeeId, input.employeeId),
				),
			)
			.limit(1);
		if (!period) {
			throw new NotFoundError({
				message: "Employment period not found",
				entityType: "employee_employment_period",
				entityId: input.employmentPeriodId,
			});
		}
		return period.id;
	}

	const current = await resolveCurrentEmploymentPeriod(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});
	if (!current) {
		throw new ValidationError({
			message: "No open employment period exists for this employee.",
			field: "employmentPeriodId",
			refusal: "no_open_employment_period",
		});
	}
	return current.id;
}

/**
 * Creates sequence 1 (`supersedes_id = NULL`) of an employment period's linear
 * `employment_term_agreement` chain.
 */
export async function createInitialEmploymentAgreementInTx(
	tx: ContractWriteTx,
	input: CreateInitialEmploymentAgreementInput,
): Promise<EmploymentTermAgreement> {
	const validated = validateAgreementFields(input);
	await lockEmployeeRow(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});

	const employmentPeriodId = await resolveTargetEmploymentPeriodIdInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId: input.employmentPeriodId,
	});

	const [existingRoot] = await tx
		.select({ id: employmentTermAgreement.id })
		.from(employmentTermAgreement)
		.where(
			and(
				eq(employmentTermAgreement.organizationId, input.organizationId),
				eq(employmentTermAgreement.employmentPeriodId, employmentPeriodId),
			),
		)
		.limit(1);

	if (existingRoot) {
		throw new ConflictError({
			message:
				"An initial employment agreement already exists for this employment period. Use recordFixedTermExtension to append the next link in the chain.",
			conflictType: "agreement_already_exists",
			details: { employmentPeriodId, existingAgreementId: existingRoot.id },
		});
	}

	const [inserted] = await tx
		.insert(employmentTermAgreement)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId,
			sequenceNumber: 1,
			supersedesId: null,
			kind: validated.kind,
			startsOn: validated.startsOn,
			endsOn: validated.endsOn,
			reason: validated.reason,
			notes: input.notes?.trim() || null,
			createdBy: input.actorUserId,
		})
		.returning();

	if (!inserted) {
		throw new Error("employment_term_agreement insert returned no row");
	}
	return inserted;
}

export async function createInitialEmploymentAgreement(
	db: DatabaseClient,
	input: CreateInitialEmploymentAgreementInput,
): Promise<EmploymentTermAgreement> {
	return db.transaction((tx) => createInitialEmploymentAgreementInTx(tx, input));
}

/**
 * Atomically appends the next link in an employment period's single-root linear
 * `employment_term_agreement` chain (`sequence_number = prev + 1`, `supersedes_id = prev.id`)
 * and synchronizes any pending scheduled departure on that period according to the admin's
 * explicit choice (`update_leaving_date`, `cancel_departure`, or `leave_unchanged`).
 */
export async function recordFixedTermExtensionInTx(
	tx: ContractWriteTx,
	input: RecordFixedTermExtensionInput,
): Promise<RecordFixedTermExtensionResult> {
	const validated = validateAgreementFields(input);
	const now = input.now ?? systemClock.nowInstant();
	const nowDate = dateFromInstant(now);

	await lockEmployeeRow(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});

	const employmentPeriodId = await resolveTargetEmploymentPeriodIdInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId: input.employmentPeriodId,
	});

	const [latest] = await tx
		.select()
		.from(employmentTermAgreement)
		.where(
			and(
				eq(employmentTermAgreement.organizationId, input.organizationId),
				eq(employmentTermAgreement.employeeId, input.employeeId),
				eq(employmentTermAgreement.employmentPeriodId, employmentPeriodId),
			),
		)
		.orderBy(desc(employmentTermAgreement.sequenceNumber))
		.limit(1);

	if (!latest) {
		throw new ValidationError({
			message:
				"No prior employment agreement exists for this employment period. Record an initial agreement before recording an extension.",
			field: "employmentPeriodId",
			refusal: "no_prior_agreement",
		});
	}

	if (validated.startsOn < latest.startsOn) {
		throw new ValidationError({
			message: "Extension start date cannot be earlier than the superseded agreement's start date.",
			field: "startsOn",
			refusal: "extension_starts_before_prior",
		});
	}

	const [inserted] = await tx
		.insert(employmentTermAgreement)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId,
			sequenceNumber: latest.sequenceNumber + 1,
			supersedesId: latest.id,
			kind: validated.kind,
			startsOn: validated.startsOn,
			endsOn: validated.endsOn,
			reason: validated.reason,
			notes: input.notes?.trim() || null,
			createdBy: input.actorUserId,
		})
		.returning();

	if (!inserted) {
		throw new Error("employment_term_agreement extension insert returned no row");
	}

	// Lock any pending/blocked scheduled departure on this employment period
	const [pendingDeparture] = await tx
		.select()
		.from(employeeDeparture)
		.where(
			and(
				eq(employeeDeparture.organizationId, input.organizationId),
				eq(employeeDeparture.employeeId, input.employeeId),
				eq(employeeDeparture.employmentPeriodId, employmentPeriodId),
				eq(employeeDeparture.mode, "scheduled"),
				inArray(employeeDeparture.status, ["pending", "blocked"]),
			),
		)
		.for("update");

	if (!pendingDeparture) {
		return {
			agreement: inserted,
			previousAgreementId: latest.id,
			departureSync: { status: "no_pending_departure" },
		};
	}

	const lifecycleActor = {
		organizationId: input.organizationId,
		userId: input.actorUserId,
	};
	const syncRequestId = randomUUID();

	if (input.departureSyncAction === "update_leaving_date") {
		if (validated.kind !== "fixed_term" || !validated.endsOn) {
			throw new ValidationError({
				message:
					"Cannot update a pending leaving date when converting to a permanent agreement. Choose cancel_departure or leave_unchanged instead.",
				field: "departureSyncAction",
				refusal: "update_leaving_date_requires_fixed_term_end",
			});
		}

		let nextCutoff: ReturnType<typeof departureCutoff>;
		try {
			nextCutoff = departureCutoff({
				lastWorkingDay: validated.endsOn,
				timezone: pendingDeparture.timezone,
				now,
			});
		} catch (error) {
			throw new ValidationError({
				message:
					error instanceof Error && error.message === "departure_date_in_past"
						? "The extended end date is in the past and cannot be scheduled as a future leaving date."
						: "Invalid departure timezone or date.",
				field: "endsOn",
				refusal: "departure_date_in_past",
			});
		}

		const [updatedDeparture] = await tx
			.update(employeeDeparture)
			.set({
				status: "pending",
				lastWorkingDay: nextCutoff.lastWorkingDay,
				cutoffAt: dateFromInstant(nextCutoff.cutoff),
				revision: sql`${employeeDeparture.revision} + 1`,
				blockedReason: null,
				processedAt: null,
				updatedAt: nowDate,
			})
			.where(
				and(
					eq(employeeDeparture.id, pendingDeparture.id),
					eq(employeeDeparture.organizationId, input.organizationId),
					eq(employeeDeparture.revision, pendingDeparture.revision),
				),
			)
			.returning({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
			});

		if (!updatedDeparture) {
			throw new ConflictError({
				message: "Pending departure was modified concurrently.",
				conflictType: "departure_revision_conflict",
			});
		}

		await synchronizeEquipmentDeparture(tx, {
			...lifecycleActor,
			employeeId: input.employeeId,
			employmentPeriodId,
			departureId: updatedDeparture.id,
		});

		await tx
			.insert(employeeDepartureTask)
			.values({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId,
				departureId: updatedDeparture.id,
				kind: "dispatch_departure",
				dedupeKey: `dispatch_departure:${updatedDeparture.id}:${updatedDeparture.revision}`,
				payload: { revision: updatedDeparture.revision },
			})
			.onConflictDoNothing();

		await queueDataExportReminder(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId,
			departureId: updatedDeparture.id,
			revision: updatedDeparture.revision,
			cutoff: nextCutoff.cutoff,
			previousCutoff: instantFromDate(pendingDeparture.cutoffAt),
			now,
		});

		const fingerprint = requestFingerprint(lifecycleActor, "fixed_term_update_departure", {
			agreementId: inserted.id,
			departureId: updatedDeparture.id,
			lastWorkingDay: nextCutoff.lastWorkingDay,
		});
		await writeReceipt(tx, {
			actor: lifecycleActor,
			employeeId: input.employeeId,
			employmentPeriodId,
			departureId: updatedDeparture.id,
			revision: updatedDeparture.revision,
			requestId: syncRequestId,
			fingerprint,
			kind: "departure_rescheduled",
			occurredAt: nowDate,
			result: {
				departureId: updatedDeparture.id,
				revision: updatedDeparture.revision,
				lastWorkingDay: nextCutoff.lastWorkingDay,
			},
			metadata: {
				source: "fixed_term_extension",
				agreementId: inserted.id,
				previousLastWorkingDay: pendingDeparture.lastWorkingDay,
			},
		});

		return {
			agreement: inserted,
			previousAgreementId: latest.id,
			departureSync: {
				status: "updated",
				departureId: updatedDeparture.id,
				previousLastWorkingDay: pendingDeparture.lastWorkingDay,
				newLastWorkingDay: nextCutoff.lastWorkingDay,
				newRevision: updatedDeparture.revision,
			},
		};
	}

	if (input.departureSyncAction === "cancel_departure") {
		const canceled = await tx.execute<{ revision: number }>(sql`
			UPDATE employee_departure
			SET status = 'canceled', revision = revision + 1, updated_at = ${nowDate}
			WHERE organization_id = ${input.organizationId}
				AND employee_id = ${input.employeeId}::uuid
				AND id = ${pendingDeparture.id}::uuid
				AND revision = ${pendingDeparture.revision}
				AND (status = 'blocked' OR (status = 'pending' AND cutoff_at > ${nowDate}))
			RETURNING revision
		`);
		const newRevision = canceled.rows[0]?.revision;
		if (newRevision === undefined) {
			throw new ConflictError({
				message: "Pending departure can no longer be canceled (already effective or modified).",
				conflictType: "departure_revision_conflict",
			});
		}

		await synchronizeEquipmentDeparture(tx, {
			...lifecycleActor,
			employeeId: input.employeeId,
			employmentPeriodId,
			departureId: pendingDeparture.id,
		});

		const fingerprint = requestFingerprint(lifecycleActor, "fixed_term_cancel_departure", {
			agreementId: inserted.id,
			departureId: pendingDeparture.id,
		});
		await writeReceipt(tx, {
			actor: lifecycleActor,
			employeeId: input.employeeId,
			employmentPeriodId,
			departureId: pendingDeparture.id,
			revision: newRevision,
			requestId: syncRequestId,
			fingerprint,
			kind: "departure_canceled",
			occurredAt: nowDate,
			result: {
				departureId: pendingDeparture.id,
				revision: newRevision,
			},
			metadata: {
				source: "fixed_term_extension",
				agreementId: inserted.id,
			},
		});

		return {
			agreement: inserted,
			previousAgreementId: latest.id,
			departureSync: {
				status: "canceled",
				departureId: pendingDeparture.id,
				newRevision,
			},
		};
	}

	// `leave_unchanged`: leave pending departure untouched and open a durable review item
	const [reviewConflict] = await tx
		.insert(contractMigrationConflict)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentHistoryId: null,
			workPolicyId: null,
			conflictKind: "other",
			dedupeKey: `fixed_term_extension_departure_review:${inserted.id}:${pendingDeparture.id}`,
			status: "open",
			details: {
				kind: "fixed_term_departure_unchanged",
				agreementId: inserted.id,
				agreementKind: inserted.kind,
				agreementEndsOn: inserted.endsOn,
				departureId: pendingDeparture.id,
				pendingLastWorkingDay: pendingDeparture.lastWorkingDay,
			},
		})
		.onConflictDoNothing()
		.returning({ id: contractMigrationConflict.id });

	return {
		agreement: inserted,
		previousAgreementId: latest.id,
		departureSync: {
			status: "left_unchanged",
			flaggedForReview: true,
			departureId: pendingDeparture.id,
			pendingLastWorkingDay: pendingDeparture.lastWorkingDay,
			reviewConflictId: reviewConflict?.id ?? null,
		},
	};
}

export async function recordFixedTermExtension(
	db: DatabaseClient,
	input: RecordFixedTermExtensionInput,
): Promise<RecordFixedTermExtensionResult> {
	return db.transaction((tx) => recordFixedTermExtensionInTx(tx, input));
}

export async function listEmploymentTermAgreements(
	db: Pick<DatabaseClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId?: string;
	},
): Promise<{
	agreements: EmploymentTermAgreement[];
	pendingScheduledDeparture: {
		id: string;
		employmentPeriodId: string;
		lastWorkingDay: string | null;
		status: string;
		revision: number;
	} | null;
}> {
	const conditions = [
		eq(employmentTermAgreement.organizationId, input.organizationId),
		eq(employmentTermAgreement.employeeId, input.employeeId),
	];
	if (input.employmentPeriodId) {
		conditions.push(eq(employmentTermAgreement.employmentPeriodId, input.employmentPeriodId));
	}

	const [agreements, [pendingDeparture]] = await Promise.all([
		db
			.select()
			.from(employmentTermAgreement)
			.where(and(...conditions))
			.orderBy(
				asc(employmentTermAgreement.employmentPeriodId),
				asc(employmentTermAgreement.sequenceNumber),
			),
		db
			.select({
				id: employeeDeparture.id,
				employmentPeriodId: employeeDeparture.employmentPeriodId,
				lastWorkingDay: employeeDeparture.lastWorkingDay,
				status: employeeDeparture.status,
				revision: employeeDeparture.revision,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, input.organizationId),
					eq(employeeDeparture.employeeId, input.employeeId),
					eq(employeeDeparture.mode, "scheduled"),
					inArray(employeeDeparture.status, ["pending", "blocked"]),
				),
			)
			.limit(1),
	]);

	return {
		agreements,
		pendingScheduledDeparture: pendingDeparture ?? null,
	};
}
