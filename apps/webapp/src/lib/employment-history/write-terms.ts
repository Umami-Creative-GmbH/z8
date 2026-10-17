import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
	type EmployeeEmploymentHistory,
	employee,
	employeeEmploymentHistory,
	workPolicy,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { compareInstants, instantFromDate, type PlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	EmploymentPeriodError,
	resolveCurrentEmploymentPeriod,
	resolveTermsEmploymentPeriod,
} from "@/lib/employee-lifecycle/employment-periods";
import type { LifecycleClient } from "@/lib/employee-lifecycle/types";
import type { ContractType } from "@/lib/validations/employee";
import {
	type EmploymentReviewState,
	type EmploymentStatus,
	type WorkModel,
	wageForContract,
} from "@/lib/validations/employment-history";
import { loadTermsInForceOn } from "./load-terms-in-force";
import { utcMidnight } from "./terms-in-force";
import { adjustConfirmedTimeline } from "./timeline";
import { removeTermsPolicy, syncTermsPolicy } from "./assignment-sync";

/**
 * The one command that writes employment terms, and with them every hourly
 * wage (Organization ADR 0002).
 *
 * Each entry point runs inside the caller's transaction, so a caller that
 * already holds its own guards (provisioning, rehire, employee creation) writes
 * the terms atomically with its other rows; a server action opens a
 * transaction and passes it in. The command locks the employee row
 * `FOR UPDATE` first, which is the last lock in every lock regime, then reads
 * the timeline of the open employment period and adjusts the neighbouring
 * confirmed terms. Every read and write is scoped by `organizationId`.
 *
 * Permission checks belong to the caller: the settings actions allow org
 * admins only. Domain refusals are thrown as `ValidationError` or
 * `NotFoundError`; post-commit work (work balance) is the caller's.
 */

/** A transaction client the caller owns. */
export type TermsWriteClient = LifecycleClient;

export type TermsWriteScope = {
	organizationId: string;
	employeeId: string;
	/** Recorded as `created_by` / `updated_by`. */
	actorUserId: string;
	/** Defaults to the current instant. */
	now?: Date;
};

/** The terms to write; `validFrom` is UTC midnight of the first calendar day (D1). */
export type EmploymentTermsInput = {
	validFrom: Date;
	status: EmploymentStatus;
	contractType: ContractType;
	weeklyContractMinutes: number;
	probationStartsOn?: Date | null;
	probationEndsOn?: Date | null;
	workModel: WorkModel;
	workPolicyId?: string | null;
	/** Required for hourly terms; dropped for fixed terms. */
	hourlyRate: number | null;
	currency: string;
	changeReason?: string | null;
	reviewState: EmploymentReviewState;
};

/** Locks the employee row; refuses an employee outside the organization. */
async function lockEmployee(tx: TermsWriteClient, scope: TermsWriteScope) {
	const locked = await tx.execute<{ id: string }>(sql`
		select ${employee.id}
		from ${employee}
		where ${employee.id} = ${scope.employeeId}
			and ${employee.organizationId} = ${scope.organizationId}
		for update
	`);
	if (locked.rows.length === 0) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: scope.employeeId,
		});
	}
}

/**
 * Terms belong to the employee's open employment period. An ended period is
 * never reopened by terms; only an explicit rehire starts a new one.
 */
async function requireTermsEmploymentPeriod(
	tx: TermsWriteClient,
	input: { organizationId: string; employeeId: string; validFrom: Date },
) {
	try {
		return await resolveTermsEmploymentPeriod(tx, input);
	} catch (error) {
		if (error instanceof EmploymentPeriodError) {
			throw new ValidationError({
				message:
					error.code === "employment_period_closed"
						? "This employee's employment has ended. Rehire them before adding employment terms."
						: "Employment terms cannot start before the current employment period.",
				field: "validFrom",
			});
		}
		throw error;
	}
}

async function requireOrganizationWorkPolicy(
	tx: TermsWriteClient,
	organizationId: string,
	workPolicyId: string,
) {
	const [policy] = await tx
		.select({ id: workPolicy.id })
		.from(workPolicy)
		.where(and(eq(workPolicy.id, workPolicyId), eq(workPolicy.organizationId, organizationId)))
		.limit(1);
	if (!policy) {
		throw new NotFoundError({
			message: "Work policy not found",
			entityType: "work_policy",
			entityId: workPolicyId,
		});
	}
}

/** Hourly terms carry a wage; refuses them without one. */
function requireHourlyWage(terms: { contractType: ContractType; hourlyRate: number | null }) {
	if (terms.contractType === "hourly" && terms.hourlyRate == null) {
		throw new ValidationError({
			message: "Hourly rate is required for hourly contracts",
			field: "hourlyRate",
		});
	}
}

/** Confirmed terms in force at `now` (UTC), for the legacy employee projection. */
export function shouldUpdateCurrentEmployeeFields(
	row: Pick<EmployeeEmploymentHistory, "reviewState" | "validFrom" | "validUntil">,
	now: Date = currentTimestamp(),
) {
	if (row.reviewState !== "confirmed") return false;
	const at = instantFromDate(now);
	return (
		compareInstants(instantFromDate(row.validFrom), at) <= 0 &&
		(!row.validUntil || compareInstants(instantFromDate(row.validUntil), at) > 0)
	);
}

export function shouldConfirmEmploymentHistoryRow(
	row: Pick<EmployeeEmploymentHistory, "reviewState">,
) {
	return row.reviewState === "draft" || row.reviewState === "pending";
}

/** Closes and shortens the neighbouring confirmed terms around `next`; returns `next` adjusted. */
async function adjustNeighbours(
	tx: TermsWriteClient,
	scope: TermsWriteScope & { now: Date },
	existing: EmployeeEmploymentHistory[],
	next: EmployeeEmploymentHistory,
) {
	const adjusted = adjustConfirmedTimeline({ existing, next });
	for (const update of adjusted.updates) {
		await tx
			.update(employeeEmploymentHistory)
			.set({ validUntil: update.validUntil, updatedBy: scope.actorUserId, updatedAt: scope.now })
			.where(
				and(
					eq(employeeEmploymentHistory.id, update.id),
					eq(employeeEmploymentHistory.employeeId, scope.employeeId),
					eq(employeeEmploymentHistory.organizationId, scope.organizationId),
				),
			);
		const previous = existing.find((row) => row.id === update.id);
		if (previous) {
			await syncTermsPolicy(tx, scope, { ...previous, validUntil: update.validUntil });
		}
	}
	return adjusted.next;
}

/** Projects the contract type of the terms in force today onto `employee.contract_type`. */
async function projectCurrentTerms(
	tx: TermsWriteClient,
	scope: TermsWriteScope & { now: Date },
	row: EmployeeEmploymentHistory,
) {
	if (!shouldUpdateCurrentEmployeeFields(row, scope.now)) return;
	await tx
		.update(employee)
		.set({ contractType: row.contractType, updatedAt: scope.now })
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		);
}

async function insertTerms(
	tx: TermsWriteClient,
	scope: TermsWriteScope & { now: Date },
	terms: EmploymentTermsInput,
): Promise<EmployeeEmploymentHistory> {
	requireHourlyWage(terms);
	if (terms.workPolicyId) {
		await requireOrganizationWorkPolicy(tx, scope.organizationId, terms.workPolicyId);
	}

	const employmentPeriodId = await requireTermsEmploymentPeriod(tx, {
		organizationId: scope.organizationId,
		employeeId: scope.employeeId,
		validFrom: terms.validFrom,
	});
	// The timeline never joins terms across employment periods.
	const existing = await tx
		.select()
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.employeeId, scope.employeeId),
				eq(employeeEmploymentHistory.organizationId, scope.organizationId),
				eq(employeeEmploymentHistory.employmentPeriodId, employmentPeriodId),
			),
		);

	const next = await adjustNeighbours(tx, scope, existing, {
		id: randomUUID(),
		employeeId: scope.employeeId,
		organizationId: scope.organizationId,
		employmentPeriodId,
		validFrom: terms.validFrom,
		validUntil: null,
		status: terms.status,
		contractType: terms.contractType,
		weeklyContractMinutes: terms.weeklyContractMinutes,
		probationStartsOn: terms.probationStartsOn ?? null,
		probationEndsOn: terms.probationEndsOn ?? null,
		workModel: terms.workModel,
		workPolicyId: terms.workPolicyId ?? null,
		hourlyRate: wageForContract(terms.contractType, terms.hourlyRate),
		currency: terms.currency,
		changeReason: terms.changeReason ?? null,
		reviewState: terms.reviewState,
		createdBy: scope.actorUserId,
		createdAt: scope.now,
		updatedBy: scope.actorUserId,
		updatedAt: scope.now,
	});

	const [inserted] = await tx.insert(employeeEmploymentHistory).values(next).returning();
	if (!inserted) throw new Error("Employment history insert returned no row");

	await projectCurrentTerms(tx, scope, inserted);
	await syncTermsPolicy(tx, scope, inserted);
	return inserted;
}

/** Writes new terms, confirmed or not, in the caller's transaction. */
export async function writeEmploymentTerms(
	tx: TermsWriteClient,
	input: TermsWriteScope & { terms: EmploymentTermsInput },
): Promise<EmployeeEmploymentHistory> {
	const scope = { ...input, now: input.now ?? currentTimestamp() };
	await lockEmployee(tx, scope);
	return insertTerms(tx, scope, input.terms);
}

/** Confirms draft or pending terms in the caller's transaction. */
export async function confirmEmploymentTerms(
	tx: TermsWriteClient,
	input: TermsWriteScope & { termsId: string },
): Promise<EmployeeEmploymentHistory> {
	const scope = { ...input, now: input.now ?? currentTimestamp() };
	await lockEmployee(tx, scope);

	const existing = await tx
		.select()
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.employeeId, scope.employeeId),
				eq(employeeEmploymentHistory.organizationId, scope.organizationId),
			),
		);
	const target = existing.find((row) => row.id === input.termsId);
	if (!target) {
		throw new NotFoundError({
			message: "Employment history not found",
			entityType: "employment_history",
			entityId: input.termsId,
		});
	}
	if (!shouldConfirmEmploymentHistoryRow(target)) {
		throw new ValidationError({
			message: "Employment history is already confirmed",
			field: "reviewState",
		});
	}
	requireHourlyWage(target);
	if (target.workPolicyId) {
		await requireOrganizationWorkPolicy(tx, scope.organizationId, target.workPolicyId);
	}

	const employmentPeriodId = await requireTermsEmploymentPeriod(tx, {
		organizationId: scope.organizationId,
		employeeId: scope.employeeId,
		validFrom: target.validFrom,
	});
	if (target.employmentPeriodId && target.employmentPeriodId !== employmentPeriodId) {
		throw new ValidationError({
			message: "These terms belong to an ended employment period and can no longer be confirmed.",
			field: "reviewState",
		});
	}

	const next = await adjustNeighbours(
		tx,
		scope,
		existing.filter((row) => row.employmentPeriodId === employmentPeriodId),
		{ ...target, employmentPeriodId, reviewState: "confirmed" },
	);

	const [updated] = await tx
		.update(employeeEmploymentHistory)
		.set({
			employmentPeriodId,
			validUntil: next.validUntil,
			reviewState: "confirmed",
			updatedBy: scope.actorUserId,
			updatedAt: scope.now,
		})
		.where(
			and(
				eq(employeeEmploymentHistory.id, input.termsId),
				eq(employeeEmploymentHistory.employeeId, scope.employeeId),
				eq(employeeEmploymentHistory.organizationId, scope.organizationId),
			),
		)
		.returning();
	if (!updated) throw new Error("Employment history update returned no row");

	await projectCurrentTerms(tx, scope, updated);
	await syncTermsPolicy(tx, scope, updated);
	return updated;
}

/**
 * "Change wage": new terms from `effectiveOn` that copy every field but the
 * wage and reason from the confirmed terms in force on that date, which must
 * be hourly. Confirmed by default; a draft leaves the timeline alone.
 */
export async function changeHourlyWage(
	tx: TermsWriteClient,
	input: TermsWriteScope & {
		effectiveOn: PlainDate;
		hourlyRate: number;
		changeReason: string;
		reviewState: "confirmed" | "draft";
	},
): Promise<EmployeeEmploymentHistory> {
	const scope = { ...input, now: input.now ?? currentTimestamp() };
	await lockEmployee(tx, scope);

	const inForce = await loadTermsInForceOn(tx, {
		organizationId: scope.organizationId,
		employeeId: scope.employeeId,
		date: input.effectiveOn,
	});
	if (inForce?.contractType !== "hourly") {
		throw new ValidationError({
			message: inForce
				? "The employment terms in force on this date are not hourly."
				: "No confirmed employment terms are in force on this date.",
			field: "validFrom",
		});
	}

	return insertTerms(tx, scope, {
		validFrom: utcMidnight(input.effectiveOn),
		status: inForce.status,
		contractType: inForce.contractType,
		weeklyContractMinutes: inForce.weeklyContractMinutes,
		probationStartsOn: inForce.probationStartsOn,
		probationEndsOn: inForce.probationEndsOn,
		workModel: inForce.workModel,
		workPolicyId: inForce.workPolicyId,
		hourlyRate: input.hourlyRate,
		currency: inForce.currency,
		changeReason: input.changeReason,
		reviewState: input.reviewState,
	});
}

export function canCancelEmploymentHistoryRow(
	row: Pick<EmployeeEmploymentHistory, "reviewState" | "validFrom">,
	now: Date = currentTimestamp(),
) {
	return (
		row.reviewState !== "confirmed" ||
		compareInstants(instantFromDate(row.validFrom), instantFromDate(now)) > 0
	);
}

/** Cancels proposed/future terms and their projection in the caller's transaction. */
export async function cancelEmploymentTerms(
	tx: TermsWriteClient,
	input: TermsWriteScope & { termsId: string },
): Promise<EmployeeEmploymentHistory> {
	const scope = { ...input, now: input.now ?? currentTimestamp() };
	await lockEmployee(tx, scope);
	const termsScope = and(
		eq(employeeEmploymentHistory.employeeId, scope.employeeId),
		eq(employeeEmploymentHistory.organizationId, scope.organizationId),
	);
	const existing = await tx
		.select()
		.from(employeeEmploymentHistory)
		.where(termsScope);
	const target = existing.find((row) => row.id === input.termsId);
	if (!target)
		throw new NotFoundError({
			message: "Employment history not found",
			entityType: "employment_history",
			entityId: input.termsId,
		});
	if (!canCancelEmploymentHistoryRow(target, scope.now)) {
		throw new ValidationError({
			message: "Employment history has already taken effect",
			field: "validFrom",
		});
	}
	await tx
		.delete(employeeEmploymentHistory)
		.where(and(termsScope, eq(employeeEmploymentHistory.id, target.id)));
	if (target.reviewState !== "confirmed") return target;

	await removeTermsPolicy(tx, scope, target);
	const period = await resolveCurrentEmploymentPeriod(tx, {
		organizationId: scope.organizationId,
		employeeId: scope.employeeId,
	});
	if (!period || (target.employmentPeriodId && target.employmentPeriodId !== period.id)) {
		return target;
	}
	const confirmed = existing
		.filter(
			(row) =>
				row.id !== target.id &&
				row.reviewState === "confirmed" &&
				row.employmentPeriodId === target.employmentPeriodId &&
				(!row.validUntil ||
					compareInstants(
						instantFromDate(row.validUntil),
						instantFromDate(row.validFrom),
					) > 0),
		)
		.sort((a, b) =>
			compareInstants(
				instantFromDate(a.validFrom),
				instantFromDate(b.validFrom),
			),
		);
	// A superseded same-start row owns no interval. Its cancellation must not
	// remove a replacement that happens to carry the same policy/natural key.
	const replacement = confirmed.find(
		(row) =>
			compareInstants(
				instantFromDate(row.validFrom),
				instantFromDate(target.validFrom),
			) === 0,
	);
	if (replacement) {
		await syncTermsPolicy(tx, scope, replacement);
		return target;
	}
	if (
		target.validUntil &&
		compareInstants(
			instantFromDate(target.validUntil),
			instantFromDate(target.validFrom),
		) <= 0
	)
		return target;

	const previous = confirmed
		.filter(
			(row) =>
				compareInstants(
					instantFromDate(row.validFrom),
					instantFromDate(target.validFrom),
				) < 0,
		)
		.at(-1);
	// Only undo a boundary introduced by these terms; do not bridge a pre-existing gap.
	if (
		!previous?.validUntil ||
		compareInstants(
			instantFromDate(previous.validUntil),
			instantFromDate(target.validFrom),
		) !== 0
	)
		return target;
	const next = confirmed.find(
		(row) =>
			compareInstants(
				instantFromDate(row.validFrom),
				instantFromDate(target.validFrom),
			) > 0,
	);
	const validUntil = next?.validFrom ?? null;
	await tx
		.update(employeeEmploymentHistory)
		.set({ validUntil, updatedBy: scope.actorUserId, updatedAt: scope.now })
		.where(and(termsScope, eq(employeeEmploymentHistory.id, previous.id)));
	await syncTermsPolicy(tx, scope, { ...previous, validUntil });
	return target;
}
