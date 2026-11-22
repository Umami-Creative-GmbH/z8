import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
	contractTemplateVersion,
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
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	EmploymentPeriodError,
	resolveTermsEmploymentPeriod,
} from "@/lib/employee-lifecycle/employment-periods";
import { utcMidnight } from "@/lib/employment-history/terms-in-force";
import { shouldUpdateCurrentEmployeeFields } from "@/lib/employment-history/write-terms";
import type { ContractType } from "@/lib/validations/employee";
import {
	type EmploymentReviewState,
	type EmploymentStatus,
	wageForContract,
} from "@/lib/validations/employment-history";
import {
	buildOnCallStatutoryPreview,
	type ContractWriteTx,
	parseIsoCalendarDate,
	recordWeeklyHoursMismatchConflictInTx,
	resolveRemotePresenceDefault,
	validateAndNormalizeCustomDays,
	validateOnCallTerms,
	validateWeeklyContractMinutes,
} from "./contract-validation";
import {
	clearPolicyAssignmentWindowInTx,
	replacePolicyAssignmentWindowInTx,
} from "./policy-assignment-intervals";
import { resolveEffectiveContractOnDay } from "./resolve-contract";
import type { CustomWorkDay, EffectiveContractOnDay, WorkModel } from "./types";

export interface CommitContractChangeInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly actorUserId: string;
	readonly validFromDate: string;
	readonly reviewState?: EmploymentReviewState;
	readonly status?: EmploymentStatus;

	// Live-inherited operational divergence fields (null / 'inherit' = live inherit from org/team default)
	readonly workPolicyId?: string | null;
	readonly weeklyContractMinutes?: number | null;
	readonly scheduleMode?: ScheduleMode | null;
	readonly customDays?: readonly CustomWorkDay[] | null;
	readonly workModel?: WorkModel | null;
	readonly presenceOverride?: PresenceOverride | null;
	readonly balanceMode?: BalanceMode | null;
	readonly scheduleSource?: ScheduleSource | null;

	// Employee-owned legal, pay, and statutory terms
	readonly contractType?: ContractType;
	readonly hourlyRate?: number | null;
	readonly currency?: string;
	readonly employmentProfile?: EmploymentProfile;
	readonly arbzgScope?: ArbzgScope;
	readonly onCallHoursKind?: OnCallHoursKind | null;
	readonly onCallWeeklyMinutes?: number | null;
	readonly onCallDailyMinutes?: number | null;
	readonly probationStartsOn?: Date | null;
	readonly probationEndsOn?: Date | null;
	readonly changeReason?: string | null;
	readonly migratedLegacyTerms?: boolean;

	// Provenance & bulk-runner deduplication
	readonly sourceTemplateVersionId?: string | null;
	readonly sourceBatchItemId?: string | null;

	/**
	 * When true and `workPolicyId` is null, also trims/deactivates any active employee-scoped
	 * `work_policy_assignment` starting from `validFromDate` so the employee inherits team/org defaults.
	 */
	readonly clearPersonalPolicyPin?: boolean;
	readonly now?: Date;
}

export interface CommitContractChangeResult {
	readonly employmentHistory: EmployeeEmploymentHistory;
	readonly customDays: readonly CustomWorkDay[];
	readonly workPolicyAssignmentId: string | null;
	readonly remoteExemptDefaultApplied: boolean;
	readonly deduplicated: boolean;
	readonly mismatchConflictRecorded: boolean;
}

export interface PreviewEmployeeContractChangeResult {
	readonly validFromDate: string;
	readonly employeeId: string;
	readonly currentContract: EffectiveContractOnDay;
	readonly remoteExemptDefaultApplied: boolean;
	readonly resolvedPresenceOverride: PresenceOverride | null;
	readonly onCallPreview: ReturnType<typeof buildOnCallStatutoryPreview>;
	readonly divergenceFields: readonly string[];
	readonly inheritedFields: readonly string[];
	readonly customDaysTotalMinutes: number | null;
}

async function lockEmployeeInTx(
	tx: ContractWriteTx,
	organizationId: string,
	employeeId: string,
): Promise<{ id: string; contractType: ContractType }> {
	const locked = await tx.execute<{ id: string; contract_type: ContractType }>(sql`
		SELECT id, contract_type
		FROM employee
		WHERE id = ${employeeId}::uuid
			AND organization_id = ${organizationId}
		FOR UPDATE
	`);
	const row = locked.rows[0];
	if (!row) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: employeeId,
		});
	}
	return { id: row.id, contractType: row.contract_type };
}

async function resolvePeriodForTermsInTx(
	tx: ContractWriteTx,
	input: { organizationId: string; employeeId: string; validFrom: Date },
): Promise<string> {
	try {
		return await resolveTermsEmploymentPeriod(tx, input);
	} catch (error) {
		if (error instanceof EmploymentPeriodError) {
			throw new ValidationError({
				message:
					error.code === "employment_period_closed"
						? "This employee's employment has ended. Rehire them before changing contract terms."
						: "Contract terms cannot start before the current employment period.",
				field: "validFromDate",
				refusal: error.code,
			});
		}
		throw error;
	}
}

async function findLatestConfirmedTermsInPeriod(
	tx: ContractWriteTx,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		validFromDate: string;
	},
): Promise<EmployeeEmploymentHistory | null> {
	const rows = await tx
		.select()
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.employeeId, input.employeeId),
				eq(employeeEmploymentHistory.employmentPeriodId, input.employmentPeriodId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
			),
		)
		.orderBy(
			asc(employeeEmploymentHistory.validFromDate),
			asc(employeeEmploymentHistory.createdAt),
		);

	// A1-5: Select strictly the confirmed row whose half-open interval [validFromDate, validUntilDate)
	// covers the requested `validFromDate`. Never pull future terms backward or revive expired gaps.
	const covering = rows.filter(
		(row) =>
			row.validFromDate <= input.validFromDate &&
			(row.validUntilDate === null || row.validUntilDate > input.validFromDate),
	);
	return covering.at(-1) ?? null;
}

/**
 * Atomically persists sparse `employee_employment_history` terms, normalized
 * `employee_employment_history_day` rows, optional `employment_terms`-sourced
 * `work_policy_assignment` pin, employee-owned classification/on-call terms, and
 * `source_batch_item_id` deduplication for `#1928`'s durable bulk runner.
 */
export async function commitContractChangeInTx(
	tx: ContractWriteTx,
	input: CommitContractChangeInput,
): Promise<CommitContractChangeResult> {
	const validFromDate = parseIsoCalendarDate(input.validFromDate, "validFromDate");
	const validFrom = utcMidnight(parsePlainDate(validFromDate));
	const now = input.now ?? currentTimestamp();
	const reviewState: EmploymentReviewState = input.reviewState ?? "confirmed";

	// Universal deadlock-free lock order (Astra #5 / H8 / M3 / M4):
	// (0) org defaults/policy advisory lock SHARED (when assigning a work policy) ->
	// (2) employee FOR UPDATE -> (3) active employee work_policy_assignment ORDER BY id FOR UPDATE ->
	// (4) work_policy FOR SHARE.
	const workPolicyId = input.workPolicyId ?? null;
	if (workPolicyId) {
		const orgLockKey = `contract_default_org:${input.organizationId}`;
		await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${orgLockKey}))`);
	}

	// 1. Lock employee row FOR UPDATE
	const empRow = await lockEmployeeInTx(tx, input.organizationId, input.employeeId);

	// 2. Atomic per-employee deduplication when called from a durable batch item (#1928)
	if (input.sourceBatchItemId) {
		const [existingBatchRow] = await tx
			.select()
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					eq(employeeEmploymentHistory.sourceBatchItemId, input.sourceBatchItemId),
				),
			)
			.limit(1);
		if (existingBatchRow) {
			const existingDays = await tx
				.select()
				.from(employeeEmploymentHistoryDay)
				.where(
					and(
						eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
						eq(employeeEmploymentHistoryDay.employmentHistoryId, existingBatchRow.id),
					),
				);
			return {
				employmentHistory: existingBatchRow,
				customDays: existingDays.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					minutesPerDay: d.minutesPerDay,
					isWorkDay: d.isWorkDay,
					latestClockIn: d.latestClockIn,
				})),
				workPolicyAssignmentId: null,
				remoteExemptDefaultApplied: false,
				deduplicated: true,
				mismatchConflictRecorded: false,
			};
		}
	}

	// 3. Resolve open employment period
	const employmentPeriodId = await resolvePeriodForTermsInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		validFrom,
	});

	// 4. Validate foreign references (workPolicyId, sourceTemplateVersionId)
	if (workPolicyId) {
		await tx.execute(sql`
			SELECT id
			FROM work_policy_assignment
			WHERE organization_id = ${input.organizationId}
				AND assignment_type = 'employee'
				AND employee_id = ${input.employeeId}::uuid
				AND is_active = true
			ORDER BY id
			FOR UPDATE
		`);
		const policyRes = await tx.execute<{ id: string; is_active: boolean }>(sql`
			SELECT id, is_active
			FROM work_policy
			WHERE id = ${workPolicyId}::uuid
				AND organization_id = ${input.organizationId}
			LIMIT 1
			FOR SHARE
		`);
		const policyRow = policyRes.rows[0];
		if (!policyRow) {
			throw new NotFoundError({
				message: "Work policy not found",
				entityType: "work_policy",
				entityId: workPolicyId,
			});
		}
		if (!policyRow.is_active) {
			throw new ValidationError({
				message: "Inactive work policies cannot be assigned to employment terms.",
				field: "workPolicyId",
				refusal: "work_policy_inactive",
			});
		}
	}

	const sourceTemplateVersionId = input.sourceTemplateVersionId ?? null;
	if (sourceTemplateVersionId) {
		const [tvRow] = await tx
			.select({ id: contractTemplateVersion.id })
			.from(contractTemplateVersion)
			.where(
				and(
					eq(contractTemplateVersion.id, sourceTemplateVersionId),
					eq(contractTemplateVersion.organizationId, input.organizationId),
				),
			)
			.limit(1);
		if (!tvRow) {
			throw new NotFoundError({
				message: "Contract template version not found",
				entityType: "contract_template_version",
				entityId: sourceTemplateVersionId,
			});
		}
	}

	// 5. Carry forward employee-owned legal/pay terms when omitted by sparse operational edits
	const priorConfirmed = await findLatestConfirmedTermsInPeriod(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId,
		validFromDate,
	});

	const contractType: ContractType =
		input.contractType ?? priorConfirmed?.contractType ?? empRow.contractType;
	const rawHourlyRate =
		input.hourlyRate !== undefined ? input.hourlyRate : (priorConfirmed?.hourlyRate ?? null);
	if (contractType === "hourly" && rawHourlyRate == null) {
		throw new ValidationError({
			message: "Hourly rate is required for hourly contracts.",
			field: "hourlyRate",
			refusal: "hourly_rate_required",
		});
	}
	const hourlyRate = wageForContract(contractType, rawHourlyRate);
	const currency = input.currency ?? priorConfirmed?.currency ?? "EUR";
	const employmentProfile: EmploymentProfile =
		input.employmentProfile ?? priorConfirmed?.employmentProfile ?? "regular";
	const arbzgScope: ArbzgScope = input.arbzgScope ?? priorConfirmed?.arbzgScope ?? "standard";
	const status: EmploymentStatus = input.status ?? priorConfirmed?.status ?? "active";

	// 6. Validate sparse operational fields & remote presence default
	const weeklyContractMinutes = validateWeeklyContractMinutes(input.weeklyContractMinutes);
	const scheduleMode: ScheduleMode | null = input.scheduleMode ?? null;
	const customDays = validateAndNormalizeCustomDays(scheduleMode, input.customDays);
	const workModel: WorkModel | null = input.workModel ?? null;
	const { presenceOverride, remoteExemptDefaultApplied } =
		resolveRemotePresenceDefault<PresenceOverride | null>({
			workModel,
			presenceOverride: input.presenceOverride,
			fallback: null,
		});
	const balanceMode: BalanceMode | null = input.balanceMode ?? null;
	const scheduleSource: ScheduleSource | null = input.scheduleSource ?? null;

	// 7. Validate 4-kind § 12 TzBfG on-call fields (matching 0323 3VL-safe IS TRUE check)
	const onCall = validateOnCallTerms({
		scheduleSource,
		onCallHoursKind: input.onCallHoursKind,
		onCallWeeklyMinutes: input.onCallWeeklyMinutes,
		onCallDailyMinutes: input.onCallDailyMinutes,
		requireKindWhenOnCall: true,
	});

	// 8. Reconcile overlapping confirmed timeline rows in `employmentPeriodId` for 0323 btree_gist
	let validUntilDate: string | null = null;
	let validUntil: Date | null = null;

	if (reviewState === "confirmed") {
		const existingConfirmed = await tx
			.select()
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					eq(employeeEmploymentHistory.employeeId, input.employeeId),
					eq(employeeEmploymentHistory.employmentPeriodId, employmentPeriodId),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
				),
			)
			.orderBy(asc(employeeEmploymentHistory.validFromDate));

		const activeSpans = existingConfirmed.filter(
			(row) => row.validUntilDate === null || row.validUntilDate > row.validFromDate,
		);

		const previous = activeSpans.filter((row) => row.validFromDate < validFromDate).at(-1);
		const sameStart = activeSpans.filter((row) => row.validFromDate === validFromDate);
		const following = activeSpans.find((row) => row.validFromDate > validFromDate);

		if (previous && (previous.validUntilDate === null || previous.validUntilDate > validFromDate)) {
			await tx
				.update(employeeEmploymentHistory)
				.set({
					validUntil: validFrom,
					validUntilDate: validFromDate,
					updatedBy: input.actorUserId,
					updatedAt: now,
				})
				.where(
					and(
						eq(employeeEmploymentHistory.id, previous.id),
						eq(employeeEmploymentHistory.organizationId, input.organizationId),
					),
				);
		}

		// Collapse superseded same-start confirmed rows to zero-width (excluded from 0323 btree_gist)
		for (const replaced of sameStart) {
			await tx
				.update(employeeEmploymentHistory)
				.set({
					validUntil: validFrom,
					validUntilDate: validFromDate,
					updatedBy: input.actorUserId,
					updatedAt: now,
				})
				.where(
					and(
						eq(employeeEmploymentHistory.id, replaced.id),
						eq(employeeEmploymentHistory.organizationId, input.organizationId),
					),
				);
		}

		if (following) {
			validUntilDate = following.validFromDate;
			validUntil = utcMidnight(parsePlainDate(following.validFromDate));
		}
	}

	// 9. Insert the new employment history row
	const historyId = randomUUID();
	const [inserted] = await tx
		.insert(employeeEmploymentHistory)
		.values({
			id: historyId,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			employmentPeriodId,
			validFrom,
			validUntil,
			validFromDate,
			validUntilDate,
			status,
			contractType,
			weeklyContractMinutes,
			probationStartsOn: input.probationStartsOn ?? priorConfirmed?.probationStartsOn ?? null,
			probationEndsOn: input.probationEndsOn ?? priorConfirmed?.probationEndsOn ?? null,
			workModel,
			workPolicyId,
			scheduleMode,
			presenceOverride,
			balanceMode,
			scheduleSource,
			sourceTemplateVersionId,
			sourceBatchItemId: input.sourceBatchItemId ?? null,
			employmentProfile,
			arbzgScope,
			onCallHoursKind: onCall.onCallHoursKind,
			onCallWeeklyMinutes: onCall.onCallWeeklyMinutes,
			onCallDailyMinutes: onCall.onCallDailyMinutes,
			migratedLegacyTerms: input.migratedLegacyTerms ?? false,
			hourlyRate,
			currency,
			changeReason: input.changeReason ?? null,
			reviewState,
			createdBy: input.actorUserId,
			createdAt: now,
			updatedBy: input.actorUserId,
			updatedAt: now,
		})
		.returning();

	if (!inserted) {
		throw new Error("employee_employment_history insert returned no row");
	}

	// 10. Persist normalized custom working days when scheduleMode === 'custom_days'
	if (scheduleMode === "custom_days" && customDays.length > 0) {
		await tx.insert(employeeEmploymentHistoryDay).values(
			customDays.map((day) => ({
				organizationId: input.organizationId,
				employmentHistoryId: inserted.id,
				dayOfWeek: day.dayOfWeek,
				minutesPerDay: day.minutesPerDay,
				isWorkDay: day.isWorkDay,
				latestClockIn: day.latestClockIn,
			})),
		);
	}

	// 11. Synchronize canonical employee `work_policy_assignment` for confirmed changes
	let workPolicyAssignmentId: string | null = null;
	if (reviewState === "confirmed") {
		const target = {
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: input.employeeId,
			priority: 2 as const,
		};
		if (workPolicyId) {
			const assignment = await replacePolicyAssignmentWindowInTx(tx, {
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				target,
				policyId: workPolicyId,
				effectiveFromDate: validFromDate,
				effectiveUntilDate: validUntilDate,
				sourceKind: "employment_terms",
				sourceContractDefaultId: null,
				sourceEmploymentHistoryId: inserted.id,
				sourceBatchItemId: input.sourceBatchItemId ?? null,
				now,
			});
			workPolicyAssignmentId = assignment?.id ?? null;
		} else if (input.clearPersonalPolicyPin) {
			await clearPolicyAssignmentWindowInTx(tx, {
				organizationId: input.organizationId,
				target,
				effectiveFromDate: validFromDate,
				effectiveUntilDate: validUntilDate,
				now,
			});
		}
	}

	// 12. Project `employee.contract_type` when the row is currently in force
	if (shouldUpdateCurrentEmployeeFields(inserted, now)) {
		await tx
			.update(employee)
			.set({ contractType: inserted.contractType, updatedAt: now })
			.where(
				and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
			);
	}

	// 13. Record mismatch conflict ONLY on mutating confirmed write paths
	let mismatchConflictRecorded = false;
	if (reviewState === "confirmed") {
		const resolved = await resolveEffectiveContractOnDay(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			date: validFromDate,
		});
		if (resolved?.mismatchWarning) {
			mismatchConflictRecorded = await recordWeeklyHoursMismatchConflictInTx(tx, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				employmentHistoryId: inserted.id,
				warning: resolved.mismatchWarning,
				triggerSource: "contract_change",
				effectiveFromDate: validFromDate,
			});
		}
	}

	return {
		employmentHistory: inserted,
		customDays: scheduleMode === "custom_days" ? customDays : [],
		workPolicyAssignmentId,
		remoteExemptDefaultApplied,
		deduplicated: false,
		mismatchConflictRecorded,
	};
}

/**
 * Transaction-owning entry point for committing a sparse employee contract change.
 */
export async function commitContractChange(
	db: DatabaseClient,
	input: CommitContractChangeInput,
): Promise<CommitContractChangeResult> {
	return db.transaction((tx) => commitContractChangeInTx(tx, input));
}

export interface ResetEmployeeContractDivergencesInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly actorUserId: string;
	readonly effectiveFromDate: string;
	readonly changeReason?: string | null;
	readonly sourceBatchItemId?: string | null;
	readonly now?: Date;
}

/**
 * 1-click "Reset to default": clears all personal operational divergences and personal
 * work policy pin as of `effectiveFromDate` while preserving employee-owned legal, pay,
 * and confirmed § 12 TzBfG on-call statutory agreement terms (A1-6).
 */
export async function resetEmployeeContractDivergencesInTx(
	tx: ContractWriteTx,
	input: ResetEmployeeContractDivergencesInput,
): Promise<CommitContractChangeResult> {
	const effectiveFromDate = parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate");
	// A2-4: Lock the employee row BEFORE reading current on-call terms so concurrent
	// contract edits cannot commit between the read and write and be clobbered.
	await tx.execute(sql`
		SELECT id
		FROM employee
		WHERE id = ${input.employeeId}::uuid
			AND organization_id = ${input.organizationId}
		FOR UPDATE
	`);
	const current = await resolveEffectiveContractOnDay(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		date: effectiveFromDate,
	});
	const preserveOnCall = current?.scheduleSource === "on_call" && current.onCallTerms !== null;

	return commitContractChangeInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		validFromDate: effectiveFromDate,
		reviewState: "confirmed",
		workPolicyId: null,
		weeklyContractMinutes: null,
		scheduleMode: null,
		customDays: null,
		workModel: null,
		presenceOverride: null,
		balanceMode: null,
		scheduleSource: preserveOnCall ? "on_call" : null,
		onCallHoursKind: preserveOnCall ? current.onCallTerms.hoursKind : null,
		onCallWeeklyMinutes: preserveOnCall ? current.onCallTerms.weeklyMinutes : null,
		onCallDailyMinutes: preserveOnCall ? current.onCallTerms.dailyMinutes : null,
		migratedLegacyTerms: false,
		changeReason: input.changeReason ?? "Reset operational terms to organization/team default",
		sourceBatchItemId: input.sourceBatchItemId ?? null,
		clearPersonalPolicyPin: true,
		now: input.now,
	});
}

export async function resetEmployeeContractDivergences(
	db: DatabaseClient,
	input: ResetEmployeeContractDivergencesInput,
): Promise<CommitContractChangeResult> {
	return db.transaction((tx) => resetEmployeeContractDivergencesInTx(tx, input));
}

export interface AdoptContractDefaultInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly actorUserId: string;
	readonly effectiveFromDate: string;
	readonly changeReason?: string | null;
	readonly sourceBatchItemId?: string | null;
	/** Optional list of operational fields to retain as personal divergences instead of adopting. */
	readonly keepDivergenceFields?: readonly (
		| "workPolicy"
		| "weeklyContractMinutes"
		| "scheduleMode"
		| "workModel"
		| "presenceOverride"
		| "balanceMode"
		| "scheduleSource"
	)[];
	readonly now?: Date;
}

/**
 * Explicitly opts an employee (typically with `migrated_legacy_terms = true`) into live
 * organization/primary-team default inheritance by writing a dated confirmed change with
 * `migrated_legacy_terms = false` and clearing adopted operational divergences while
 * preserving employee-owned legal & pay terms.
 */
export async function adoptContractDefaultInTx(
	tx: ContractWriteTx,
	input: AdoptContractDefaultInput,
): Promise<CommitContractChangeResult> {
	const effectiveFromDate = parseIsoCalendarDate(input.effectiveFromDate, "effectiveFromDate");
	const keep = new Set(input.keepDivergenceFields ?? []);

	// A2-4: Lock the employee row BEFORE reading current divergences & on-call terms so
	// concurrent edits cannot be overwritten by stale values.
	await tx.execute(sql`
		SELECT id
		FROM employee
		WHERE id = ${input.employeeId}::uuid
			AND organization_id = ${input.organizationId}
		FOR UPDATE
	`);

	const current = await resolveEffectiveContractOnDay(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		date: effectiveFromDate,
	});
	if (!current) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}

	let keptCustomDays: readonly CustomWorkDay[] | null = null;
	if (
		keep.has("scheduleMode") &&
		current.scheduleMode === "custom_days" &&
		current.employmentHistoryId
	) {
		const existingDays = await tx
			.select()
			.from(employeeEmploymentHistoryDay)
			.where(
				and(
					eq(employeeEmploymentHistoryDay.organizationId, input.organizationId),
					eq(employeeEmploymentHistoryDay.employmentHistoryId, current.employmentHistoryId),
				),
			);
		keptCustomDays = existingDays.map((d) => ({
			dayOfWeek: d.dayOfWeek,
			minutesPerDay: d.minutesPerDay,
			isWorkDay: d.isWorkDay,
			latestClockIn: d.latestClockIn,
		}));
	}

	// A1-6: Employee-owned § 12 TzBfG on-call statutory agreements always carry through default adoption.
	const preserveOnCall = current.scheduleSource === "on_call" && current.onCallTerms !== null;
	const keptScheduleSource = preserveOnCall
		? "on_call"
		: keep.has("scheduleSource")
			? current.scheduleSource
			: null;
	const keepOnCall = preserveOnCall;

	return commitContractChangeInTx(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		validFromDate: effectiveFromDate,
		reviewState: "confirmed",
		workPolicyId: keep.has("workPolicy") ? (current.workPolicy?.policyId ?? null) : null,
		weeklyContractMinutes: keep.has("weeklyContractMinutes") ? current.weeklyContractMinutes : null,
		scheduleMode: keep.has("scheduleMode") ? current.scheduleMode : null,
		customDays: keptCustomDays,
		workModel: keep.has("workModel") ? current.workModel : null,
		presenceOverride: keep.has("presenceOverride") ? current.presenceOverride : null,
		balanceMode: keep.has("balanceMode") ? current.balanceMode : null,
		scheduleSource: keptScheduleSource,
		onCallHoursKind: keepOnCall ? current.onCallTerms.hoursKind : null,
		onCallWeeklyMinutes: keepOnCall ? current.onCallTerms.weeklyMinutes : null,
		onCallDailyMinutes: keepOnCall ? current.onCallTerms.dailyMinutes : null,
		migratedLegacyTerms: false,
		changeReason: input.changeReason ?? "Adopted organization/primary-team default contract",
		sourceBatchItemId: input.sourceBatchItemId ?? null,
		clearPersonalPolicyPin: !keep.has("workPolicy"),
		now: input.now,
	});
}

export async function adoptContractDefault(
	db: DatabaseClient,
	input: AdoptContractDefaultInput,
): Promise<CommitContractChangeResult> {
	return db.transaction((tx) => adoptContractDefaultInTx(tx, input));
}

/**
 * Strictly read-only preview of a proposed employee contract change: validates inputs,
 * previews remote `presence_override = 'exempt'` defaulting, lists sparse divergence vs.
 * inherited fields, and formats § 12 TzBfG on-call statutory preview notes.
 */
export async function previewEmployeeContractChange(
	db: Pick<DatabaseClient, "select">,
	input: Omit<CommitContractChangeInput, "actorUserId" | "now">,
): Promise<PreviewEmployeeContractChangeResult> {
	const validFromDate = parseIsoCalendarDate(input.validFromDate, "validFromDate");
	validateWeeklyContractMinutes(input.weeklyContractMinutes);
	const customDays = validateAndNormalizeCustomDays(input.scheduleMode, input.customDays);
	const { presenceOverride, remoteExemptDefaultApplied } =
		resolveRemotePresenceDefault<PresenceOverride | null>({
			workModel: input.workModel ?? null,
			presenceOverride: input.presenceOverride,
			fallback: null,
		});

	const scheduleSource = input.scheduleSource ?? null;
	const onCall = validateOnCallTerms({
		scheduleSource,
		onCallHoursKind: input.onCallHoursKind,
		onCallWeeklyMinutes: input.onCallWeeklyMinutes,
		onCallDailyMinutes: input.onCallDailyMinutes,
		requireKindWhenOnCall: true,
	});

	const currentContract = await resolveEffectiveContractOnDay(db, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		date: validFromDate,
	});
	if (!currentContract) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}

	const divergenceFields: string[] = [];
	const inheritedFields: string[] = [];

	const classify = (field: string, isDiverged: boolean) => {
		if (isDiverged) divergenceFields.push(field);
		else inheritedFields.push(field);
	};

	classify("workPolicy", Boolean(input.workPolicyId));
	classify(
		"weeklyContractMinutes",
		input.weeklyContractMinutes !== null && input.weeklyContractMinutes !== undefined,
	);
	classify(
		"scheduleMode",
		input.scheduleMode !== null &&
			input.scheduleMode !== undefined &&
			input.scheduleMode !== "inherit",
	);
	classify("workModel", input.workModel !== null && input.workModel !== undefined);
	classify(
		"presenceOverride",
		presenceOverride !== null && presenceOverride !== undefined && presenceOverride !== "inherit",
	);
	classify("balanceMode", input.balanceMode !== null && input.balanceMode !== undefined);
	classify("scheduleSource", scheduleSource !== null && scheduleSource !== undefined);

	const effectiveScheduleSource = scheduleSource ?? currentContract.scheduleSource;
	const onCallPreview = buildOnCallStatutoryPreview({
		scheduleSource: effectiveScheduleSource,
		onCallHoursKind: onCall.onCallHoursKind,
		onCallWeeklyMinutes: onCall.onCallWeeklyMinutes,
		onCallDailyMinutes: onCall.onCallDailyMinutes,
	});

	const customDaysTotalMinutes =
		input.scheduleMode === "custom_days"
			? customDays.reduce((acc, d) => acc + (d.isWorkDay ? d.minutesPerDay : 0), 0)
			: null;

	return {
		validFromDate,
		employeeId: input.employeeId,
		currentContract,
		remoteExemptDefaultApplied,
		resolvedPresenceOverride: presenceOverride,
		onCallPreview,
		divergenceFields,
		inheritedFields,
		customDaysTotalMinutes,
	};
}
