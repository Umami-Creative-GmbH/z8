import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
	type EmployeeEmploymentHistory,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentHistoryDay,
} from "@/db/schema";
import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import {
	doesLinkedTermsPolicyAssignmentCoverDayInTx,
	verifyWorkPolicyForTermsInTx,
} from "@/lib/contracts/policy-assignment-intervals";
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
	weeklyContractMinutes: number | null;
	probationStartsOn?: Date | null;
	probationEndsOn?: Date | null;
	workModel: WorkModel | null;
	workPolicyId?: string | null;
	/** Required for hourly terms; dropped for fixed terms. */
	hourlyRate: number | null;
	currency: string;
	changeReason?: string | null;
	reviewState: EmploymentReviewState;
	/** Optional unified-contract fields preserved across pay-only edits (A1-4). */
	scheduleMode?: ScheduleMode | null;
	presenceOverride?: PresenceOverride | null;
	balanceMode?: BalanceMode | null;
	scheduleSource?: ScheduleSource | null;
	sourceTemplateVersionId?: string | null;
	employmentProfile?: EmploymentProfile;
	arbzgScope?: ArbzgScope;
	onCallHoursKind?: OnCallHoursKind | null;
	onCallWeeklyMinutes?: number | null;
	onCallDailyMinutes?: number | null;
	migratedLegacyTerms?: boolean;
};

function toUtcPlainDateString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

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

async function lockOrgKeyShare(tx: TermsWriteClient, organizationId: string) {
	await tx.execute(sql`
		SELECT id
		FROM organization
		WHERE id = ${organizationId}
		FOR KEY SHARE
	`);
}

async function lockOrgPolicyShared(tx: TermsWriteClient, organizationId: string) {
	// F11-3 / Astra #2 & #3: Align terms writes with universal lock order
	// (0 org policy advisory SHARED -> 1.5 organization FOR KEY SHARE -> 2 employee -> 4 work_policy FOR SHARE).
	const orgLockKey = `contract_default_org:${organizationId}`;
	await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${orgLockKey}))`);
	await lockOrgKeyShare(tx, organizationId);
}

async function requireOrganizationWorkPolicy(
	tx: TermsWriteClient,
	organizationId: string,
	workPolicyId: string,
	allowHistoricalUntilDateIso: string | null = null,
) {
	const status = await verifyWorkPolicyForTermsInTx(tx as never, {
		organizationId,
		policyId: workPolicyId,
		allowHistoricalUntilDateIso,
	});
	if (status === "not_found") {
		throw new NotFoundError({
			message: "Work policy not found",
			entityType: "work_policy",
			entityId: workPolicyId,
		});
	}
	if (status === "inactive") {
		throw new ValidationError({
			message: "Inactive work policies cannot be assigned to employment terms.",
			field: "workPolicyId",
			refusal: "work_policy_inactive",
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
			.set({
				validUntil: update.validUntil,
				validUntilDate: update.validUntil ? toUtcPlainDateString(update.validUntil) : null,
				updatedBy: scope.actorUserId,
				updatedAt: scope.now,
			})
			.where(
				and(
					eq(employeeEmploymentHistory.id, update.id),
					eq(employeeEmploymentHistory.employeeId, scope.employeeId),
					eq(employeeEmploymentHistory.organizationId, scope.organizationId),
				),
			);
	}
	return {
		...adjusted.next,
		validFromDate: toUtcPlainDateString(adjusted.next.validFrom),
		validUntilDate: adjusted.next.validUntil
			? toUtcPlainDateString(adjusted.next.validUntil)
			: null,
	};
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
	scope: TermsWriteScope & { now: Date; useDbClockTimestamp?: boolean },
	terms: EmploymentTermsInput,
	options?: { allowCopiedHistoricalPolicy?: boolean; sourceTermsValidUntilDate?: string | null },
): Promise<EmployeeEmploymentHistory> {
	requireHourlyWage(terms);

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

	const draftNext: EmployeeEmploymentHistory = {
		id: randomUUID(),
		employeeId: scope.employeeId,
		organizationId: scope.organizationId,
		employmentPeriodId,
		validFrom: terms.validFrom,
		validUntil: null,
		validFromDate: toUtcPlainDateString(terms.validFrom),
		validUntilDate: null,
		status: terms.status,
		contractType: terms.contractType,
		weeklyContractMinutes: terms.weeklyContractMinutes,
		probationStartsOn: terms.probationStartsOn ?? null,
		probationEndsOn: terms.probationEndsOn ?? null,
		workModel: terms.workModel,
		workPolicyId: terms.workPolicyId ?? null,
		scheduleMode: terms.scheduleMode ?? null,
		presenceOverride: terms.presenceOverride ?? null,
		balanceMode: terms.balanceMode ?? null,
		scheduleSource: terms.scheduleSource ?? null,
		sourceTemplateVersionId: terms.sourceTemplateVersionId ?? null,
		sourceBatchItemId: null,
		employmentProfile: terms.employmentProfile ?? "regular",
		arbzgScope: terms.arbzgScope ?? "standard",
		onCallHoursKind: terms.onCallHoursKind ?? null,
		onCallWeeklyMinutes: terms.onCallWeeklyMinutes ?? null,
		onCallDailyMinutes: terms.onCallDailyMinutes ?? null,
		migratedLegacyTerms: terms.migratedLegacyTerms ?? false,
		hourlyRate: wageForContract(terms.contractType, terms.hourlyRate),
		currency: terms.currency,
		changeReason: terms.changeReason ?? null,
		reviewState: terms.reviewState,
		createdBy: scope.actorUserId,
		createdAt: scope.now,
		updatedBy: scope.actorUserId,
		updatedAt: scope.now,
	};

	if (terms.workPolicyId) {
		let allowHistoricalUntilDateIso: string | null = null;
		if (options?.allowCopiedHistoricalPolicy) {
			const hypotheticalConfirmed = adjustConfirmedTimeline({
				existing,
				next: { ...draftNext, reviewState: "confirmed" },
			});
			allowHistoricalUntilDateIso = hypotheticalConfirmed.next.validUntil
				? toUtcPlainDateString(hypotheticalConfirmed.next.validUntil)
				: (options.sourceTermsValidUntilDate ?? null);
		}
		await requireOrganizationWorkPolicy(
			tx,
			scope.organizationId,
			terms.workPolicyId,
			allowHistoricalUntilDateIso,
		);
	}

	const next = await adjustNeighbours(tx, scope, existing, draftNext);

	const [inserted] = await tx
		.insert(employeeEmploymentHistory)
		.values({
			...next,
			createdAt: scope.useDbClockTimestamp ? sql`clock_timestamp()` : next.createdAt,
		})
		.returning();
	if (!inserted) throw new Error("Employment history insert returned no row");

	await projectCurrentTerms(tx, scope, inserted);
	return inserted;
}

/** Writes new terms, confirmed or not, in the caller's transaction. */
export async function writeEmploymentTerms(
	tx: TermsWriteClient,
	input: TermsWriteScope & { terms: EmploymentTermsInput; useDbClockTimestamp?: boolean },
): Promise<EmployeeEmploymentHistory> {
	// Astra #2: Always lock (1.5) organization FOR KEY SHARE before (2) employee FOR UPDATE,
	// and acquire (0) SHARED when pinning a work policy.
	if (input.terms.workPolicyId) {
		await lockOrgPolicyShared(tx, input.organizationId);
	} else {
		await lockOrgKeyShare(tx, input.organizationId);
	}
	await lockEmployee(tx, input);
	// Astra #8: Capture timestamp strictly AFTER acquiring locks.
	const scope = {
		...input,
		now: input.now ?? currentTimestamp(),
		useDbClockTimestamp: input.useDbClockTimestamp ?? input.now === undefined,
	};
	return insertTerms(tx, scope, input.terms);
}

/** Confirms draft or pending terms in the caller's transaction. */
export async function confirmEmploymentTerms(
	tx: TermsWriteClient,
	input: TermsWriteScope & { termsId: string },
): Promise<EmployeeEmploymentHistory> {
	await lockOrgPolicyShared(tx, input.organizationId);
	await lockEmployee(tx, input);
	const scope = { ...input, now: input.now ?? currentTimestamp() };

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

	const periodExisting = existing.filter((row) => row.employmentPeriodId === employmentPeriodId);
	const previewAdjusted = adjustConfirmedTimeline({
		existing: periodExisting,
		next: { ...target, employmentPeriodId, reviewState: "confirmed" },
	});
	if (target.workPolicyId) {
		// Opus #1: Allow confirming a backdated historical draft whose entire confirmed interval ends
		// on or before the policy's retirement date, while rejecting active/future pins to inactive policies.
		const confirmedEndDateIso = previewAdjusted.next.validUntil
			? toUtcPlainDateString(previewAdjusted.next.validUntil)
			: null;
		await requireOrganizationWorkPolicy(
			tx,
			scope.organizationId,
			target.workPolicyId,
			confirmedEndDateIso,
		);
	}

	const next = await adjustNeighbours(tx, scope, periodExisting, {
		...target,
		employmentPeriodId,
		reviewState: "confirmed",
	});

	const [updated] = await tx
		.update(employeeEmploymentHistory)
		.set({
			employmentPeriodId,
			validUntil: next.validUntil,
			validUntilDate: next.validUntilDate,
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
	await lockOrgPolicyShared(tx, input.organizationId);
	await lockEmployee(tx, input);
	const scope = {
		...input,
		now: input.now ?? currentTimestamp(),
		useDbClockTimestamp: input.now === undefined,
	};

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

	// Astra #4: If the source terms row carries a policy pin backed by a linked
	// `work_policy_assignment` that no longer actively covers `effectiveOn` (e.g. capped on
	// retirement or superseded), clear `workPolicyId` so a pay-only edit never revives or fails on it.
	let copiedWorkPolicyId = inForce.workPolicyId;
	if (copiedWorkPolicyId) {
		const coversDay = await doesLinkedTermsPolicyAssignmentCoverDayInTx(tx as never, {
			organizationId: scope.organizationId,
			employmentHistoryId: inForce.id,
			policyId: copiedWorkPolicyId,
			dayIso: input.effectiveOn.toString(),
		});
		if (!coversDay) {
			copiedWorkPolicyId = null;
		}
	}

	// A1-4: Preserve all classification, statutory on-call, operational divergences, and
	// normalized custom working days when recording a pay-only hourly wage change.
	const existingDays = await tx
		.select({
			dayOfWeek: employeeEmploymentHistoryDay.dayOfWeek,
			minutesPerDay: employeeEmploymentHistoryDay.minutesPerDay,
			isWorkDay: employeeEmploymentHistoryDay.isWorkDay,
			latestClockIn: employeeEmploymentHistoryDay.latestClockIn,
		})
		.from(employeeEmploymentHistoryDay)
		.where(
			and(
				eq(employeeEmploymentHistoryDay.organizationId, scope.organizationId),
				eq(employeeEmploymentHistoryDay.employmentHistoryId, inForce.id),
			),
		);

	const inserted = await insertTerms(
		tx,
		scope,
		{
			validFrom: utcMidnight(input.effectiveOn),
			status: inForce.status,
			contractType: inForce.contractType,
			weeklyContractMinutes: inForce.weeklyContractMinutes,
			probationStartsOn: inForce.probationStartsOn,
			probationEndsOn: inForce.probationEndsOn,
			workModel: inForce.workModel,
			workPolicyId: copiedWorkPolicyId,
			scheduleMode: inForce.scheduleMode,
			presenceOverride: inForce.presenceOverride,
			balanceMode: inForce.balanceMode,
			scheduleSource: inForce.scheduleSource,
			sourceTemplateVersionId: inForce.sourceTemplateVersionId,
			employmentProfile: inForce.employmentProfile,
			arbzgScope: inForce.arbzgScope,
			onCallHoursKind: inForce.onCallHoursKind,
			onCallWeeklyMinutes: inForce.onCallWeeklyMinutes,
			onCallDailyMinutes: inForce.onCallDailyMinutes,
			migratedLegacyTerms: inForce.migratedLegacyTerms,
			hourlyRate: input.hourlyRate,
			currency: inForce.currency,
			changeReason: input.changeReason,
			reviewState: input.reviewState,
		},
		{
			allowCopiedHistoricalPolicy: true,
			sourceTermsValidUntilDate: inForce.validUntil
				? toUtcPlainDateString(inForce.validUntil)
				: null,
		},
	);

	if (existingDays.length > 0) {
		await tx.insert(employeeEmploymentHistoryDay).values(
			existingDays.map((day) => ({
				organizationId: scope.organizationId,
				employmentHistoryId: inserted.id,
				dayOfWeek: day.dayOfWeek,
				minutesPerDay: day.minutesPerDay,
				isWorkDay: day.isWorkDay,
				latestClockIn: day.latestClockIn,
			})),
		);
	}

	return inserted;
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
	await lockOrgKeyShare(tx, input.organizationId);
	await lockEmployee(tx, input);
	const scope = { ...input, now: input.now ?? currentTimestamp() };
	const termsScope = and(
		eq(employeeEmploymentHistory.employeeId, scope.employeeId),
		eq(employeeEmploymentHistory.organizationId, scope.organizationId),
	);
	const existing = await tx.select().from(employeeEmploymentHistory).where(termsScope);
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
					compareInstants(instantFromDate(row.validUntil), instantFromDate(row.validFrom)) > 0),
		)
		.sort((a, b) => compareInstants(instantFromDate(a.validFrom), instantFromDate(b.validFrom)));
	// A superseded same-start row owns no interval; leave the active replacement intact.
	const replacement = confirmed.find(
		(row) =>
			compareInstants(instantFromDate(row.validFrom), instantFromDate(target.validFrom)) === 0,
	);
	if (replacement) {
		return target;
	}
	if (
		target.validUntil &&
		compareInstants(instantFromDate(target.validUntil), instantFromDate(target.validFrom)) <= 0
	)
		return target;

	const previous = confirmed
		.filter(
			(row) =>
				compareInstants(instantFromDate(row.validFrom), instantFromDate(target.validFrom)) < 0,
		)
		.at(-1);
	// Only undo a boundary introduced by these terms; do not bridge a pre-existing gap.
	if (
		!previous?.validUntil ||
		compareInstants(instantFromDate(previous.validUntil), instantFromDate(target.validFrom)) !== 0
	)
		return target;
	const next = confirmed.find(
		(row) => compareInstants(instantFromDate(row.validFrom), instantFromDate(target.validFrom)) > 0,
	);
	const validUntil = next?.validFrom ?? null;
	await tx
		.update(employeeEmploymentHistory)
		.set({
			validUntil,
			validUntilDate: validUntil ? toUtcPlainDateString(validUntil) : null,
			updatedBy: scope.actorUserId,
			updatedAt: scope.now,
		})
		.where(and(termsScope, eq(employeeEmploymentHistory.id, previous.id)));
	return target;
}
