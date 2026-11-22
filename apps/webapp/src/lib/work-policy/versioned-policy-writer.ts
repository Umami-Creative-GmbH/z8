import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
	auditLog,
	contractDefault,
	contractTemplateVersion,
	contractTemplateVersionDay,
	employeeEmploymentHistory,
	employeeEmploymentHistoryDay,
	workPolicy,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyPresence,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
	workPolicyVersion,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { utcMidnight } from "@/lib/employment-history/terms-in-force";
import { hasValidLatestClockIns, latestClockInForDay } from "@/lib/scheduling/latest-clock-in";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

export type PolicyTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface PolicyScheduleDayInput {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek?: number;
	latestClockIn?: string | null;
}

export interface PolicyScheduleInput {
	scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
	scheduleType: "simple" | "detailed";
	workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
	hoursPerCycle?: string;
	homeOfficeDaysPerCycle?: number;
	days?: PolicyScheduleDayInput[];
}

export interface PolicyBreakOptionInput {
	splitCount: number | null;
	minimumSplitMinutes: number | null;
	minimumLongestSplitMinutes: number | null;
}

export interface PolicyBreakRuleInput {
	workingMinutesThreshold: number;
	requiredBreakMinutes: number;
	options: PolicyBreakOptionInput[];
}

export interface PolicyRegulationInput {
	maxDailyMinutes?: number | null;
	maxWeeklyMinutes?: number | null;
	maxUninterruptedMinutes?: number | null;
	minRestPeriodMinutes?: number | null;
	restPeriodEnforcement?: "block" | "warn" | "none" | null;
	overtimeDailyThresholdMinutes?: number | null;
	overtimeWeeklyThresholdMinutes?: number | null;
	overtimeMonthlyThresholdMinutes?: number | null;
	alertBeforeLimitMinutes?: number | null;
	alertThresholdPercent?: number | null;
	breakRules: PolicyBreakRuleInput[];
}

export interface PolicyPresenceInput {
	presenceMode: "minimum_count" | "fixed_days";
	requiredOnsiteDays?: number;
	requiredOnsiteFixedDays?: string[];
	locationId?: string | null;
	evaluationPeriod?: "weekly" | "biweekly" | "monthly";
	enforcement?: "block" | "warn" | "none";
}

export interface CreateVersionedPolicyInput {
	name: string;
	description?: string;
	scheduleEnabled: boolean;
	regulationEnabled: boolean;
	presenceEnabled: boolean;
	effectiveFromDate?: string;
	schedule?: PolicyScheduleInput;
	regulation?: PolicyRegulationInput;
	presence?: PolicyPresenceInput;
}

export interface UpdateVersionedPolicyInput {
	name?: string;
	description?: string;
	isActive?: boolean;
	scheduleEnabled?: boolean;
	regulationEnabled?: boolean;
	presenceEnabled?: boolean;
	effectiveFromDate?: string;
	schedule?: PolicyScheduleInput;
	regulation?: PolicyRegulationInput;
	presence?: PolicyPresenceInput | null;
}

export interface SameDayReplacementWarning {
	readonly replacedVersionId: string;
	readonly replacedVersionNumber: number;
	readonly effectiveFromDate: string;
	readonly message: string;
}

export interface PolicyVersionSummary {
	readonly id: string;
	readonly versionNumber: number;
	readonly effectiveFromDate: string;
	readonly scheduleEnabled: boolean;
	readonly regulationEnabled: boolean;
	readonly presenceEnabled: boolean;
	readonly sealedAt: Date | null;
}

export interface LaterScheduledVersionWarning {
	readonly id: string;
	readonly versionNumber: number;
	readonly effectiveFromDate: string;
}

export type VersionedWorkPolicyDetails = typeof workPolicy.$inferSelect & {
	versionEffectiveDates?: string[];
	schedule:
		| (typeof workPolicySchedule.$inferSelect & {
				days: (typeof workPolicyScheduleDay.$inferSelect)[];
		  })
		| null;
	regulation:
		| (typeof workPolicyRegulation.$inferSelect & {
				breakRules: (typeof workPolicyBreakRule.$inferSelect & {
					options: (typeof workPolicyBreakOption.$inferSelect)[];
				})[];
		  })
		| null;
	presence: typeof workPolicyPresence.$inferSelect | null;
};

export interface PublishWorkPolicyVersionResult {
	readonly policy: VersionedWorkPolicyDetails;
	readonly version: PolicyVersionSummary;
	readonly replacesSameDayVersion: SameDayReplacementWarning | null;
	readonly laterScheduledVersions: readonly LaterScheduledVersionWarning[];
	readonly metadataOnly: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAIN_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function toRows(result: unknown): Record<string, unknown>[] {
	if (
		typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
	) {
		return result.rows as Record<string, unknown>[];
	}
	return [];
}

function parseVersionSummaryRow(row: Record<string, unknown>): PolicyVersionSummary {
	const rawSealedAt = row.sealedAt;
	return {
		id: String(row.id),
		versionNumber: Number(row.versionNumber),
		effectiveFromDate: String(row.effectiveFromDate),
		scheduleEnabled: Boolean(row.scheduleEnabled),
		regulationEnabled: Boolean(row.regulationEnabled),
		presenceEnabled: Boolean(row.presenceEnabled),
		sealedAt:
			rawSealedAt instanceof Date
				? rawSealedAt
				: typeof rawSealedAt === "string"
					? new Date(rawSealedAt)
					: null,
	};
}

function normalizeDateInput(
	date: string | undefined,
	field = "effectiveFromDate",
): string | undefined {
	if (date === undefined) return undefined;
	if (!PLAIN_DATE_REGEX.test(date)) {
		throw new ValidationError({
			message: "Effective date must use YYYY-MM-DD format",
			field,
		});
	}
	return date;
}

function resolveRegulationValues(
	incoming: PolicyRegulationInput,
	existing: typeof workPolicyRegulation.$inferSelect | null,
) {
	return {
		maxDailyMinutes:
			incoming.maxDailyMinutes !== undefined
				? incoming.maxDailyMinutes
				: (existing?.maxDailyMinutes ?? null),
		maxWeeklyMinutes:
			incoming.maxWeeklyMinutes !== undefined
				? incoming.maxWeeklyMinutes
				: (existing?.maxWeeklyMinutes ?? null),
		maxUninterruptedMinutes:
			incoming.maxUninterruptedMinutes !== undefined
				? incoming.maxUninterruptedMinutes
				: (existing?.maxUninterruptedMinutes ?? null),
		minRestPeriodMinutes:
			incoming.minRestPeriodMinutes !== undefined
				? incoming.minRestPeriodMinutes
				: (existing?.minRestPeriodMinutes ?? null),
		restPeriodEnforcement:
			incoming.restPeriodEnforcement !== undefined
				? incoming.restPeriodEnforcement
				: (existing?.restPeriodEnforcement ?? "warn"),
		overtimeDailyThresholdMinutes:
			incoming.overtimeDailyThresholdMinutes !== undefined
				? incoming.overtimeDailyThresholdMinutes
				: (existing?.overtimeDailyThresholdMinutes ?? null),
		overtimeWeeklyThresholdMinutes:
			incoming.overtimeWeeklyThresholdMinutes !== undefined
				? incoming.overtimeWeeklyThresholdMinutes
				: (existing?.overtimeWeeklyThresholdMinutes ?? null),
		overtimeMonthlyThresholdMinutes:
			incoming.overtimeMonthlyThresholdMinutes !== undefined
				? incoming.overtimeMonthlyThresholdMinutes
				: (existing?.overtimeMonthlyThresholdMinutes ?? null),
		alertBeforeLimitMinutes:
			incoming.alertBeforeLimitMinutes !== undefined
				? incoming.alertBeforeLimitMinutes
				: (existing?.alertBeforeLimitMinutes ?? 30),
		alertThresholdPercent:
			incoming.alertThresholdPercent !== undefined
				? incoming.alertThresholdPercent
				: (existing?.alertThresholdPercent ?? 80),
	};
}

/**
 * Locks a referenced presence location `FOR SHARE`, verifying tenant ownership (and optionally
 * `is_active = true`). Always called AFTER locking `work_policy` to keep lock ordering strictly
 * acyclic (`work_policy -> location`).
 */
export async function lockOwnedLocationForShareInTx(
	tx: PolicyTransaction,
	organizationId: string,
	locationId: string,
	requireActive: boolean,
): Promise<void> {
	if (!UUID_REGEX.test(locationId)) {
		throw new ValidationError({
			message: "Referenced presence location is invalid",
			field: "presence.locationId",
			refusal: "location_inactive",
		});
	}
	const result = await tx.execute(sql`
		SELECT "id", "is_active" AS "isActive"
		FROM "location"
		WHERE "id" = ${locationId}::uuid
			AND "organization_id" = ${organizationId}
		FOR SHARE
	`);
	const row = toRows(result)[0];
	if (!row || (requireActive && row.isActive !== true)) {
		throw new ValidationError({
			message: requireActive
				? "Referenced presence location is inactive or does not exist"
				: "Referenced presence location does not belong to this organization",
			field: "presence.locationId",
			refusal: "location_inactive",
		});
	}
}

export async function lockActiveLocationForShareInTx(
	tx: PolicyTransaction,
	organizationId: string,
	locationId: string,
): Promise<void> {
	return lockOwnedLocationForShareInTx(tx, organizationId, locationId, true);
}

/**
 * Validates and locks (`FOR SHARE`) every location referenced by currently effective or future
 * presence-enabled versions of a policy before reactivating it (A1-30 / A2-17).
 */
async function validateReactivationPresenceLocationsInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		policyId: string;
		versions: readonly PolicyVersionSummary[];
		orgTodayDate: string;
		excludeVersionIds?: ReadonlySet<string>;
	},
): Promise<void> {
	if (input.versions.length === 0) return;
	const currentEffective =
		input.versions.find((v) => v.effectiveFromDate <= input.orgTodayDate) ?? null;
	// A3-21: Deduplicate future revisions per effective_from_date (highest versionNumber wins),
	// matching location-lifecycle.ts so a superseded same-day revision never blocks reactivation.
	const winningFutureByDate = new Map<string, PolicyVersionSummary>();
	for (const v of input.versions) {
		if (v.effectiveFromDate <= input.orgTodayDate) continue;
		const existing = winningFutureByDate.get(v.effectiveFromDate);
		if (!existing || v.versionNumber > existing.versionNumber) {
			winningFutureByDate.set(v.effectiveFromDate, v);
		}
	}
	const futureVersions = [...winningFutureByDate.values()];
	const activePresenceVersionIds = [
		...(currentEffective &&
		currentEffective.presenceEnabled &&
		!input.excludeVersionIds?.has(currentEffective.id)
			? [currentEffective.id]
			: []),
		...futureVersions
			.filter((v) => v.presenceEnabled && !input.excludeVersionIds?.has(v.id))
			.map((v) => v.id),
	];
	if (activePresenceVersionIds.length === 0) return;

	const presenceRows = await tx
		.select({ locationId: workPolicyPresence.locationId })
		.from(workPolicyPresence)
		.where(
			and(
				eq(workPolicyPresence.policyId, input.policyId),
				inArray(workPolicyPresence.policyVersionId, activePresenceVersionIds),
			),
		);
	const uniqueLocationIds = [
		...new Set(presenceRows.map((row) => row.locationId).filter((id): id is string => Boolean(id))),
	].sort((a, b) => a.localeCompare(b));
	for (const locId of uniqueLocationIds) {
		await lockActiveLocationForShareInTx(tx, input.organizationId, locId);
	}
}

/**
 * Acquires the organization-wide contract-default advisory lock in EXCLUSIVE mode (level 0)
 * and `organization FOR KEY SHARE` (level 1.5) BEFORE locking employees (level 2), policy
 * assignments (level 3), or `work_policy` (level 4), serializing policy retirement against ALL
 * concurrent default schedulers, employee policy writers, and lifecycle commands without
 * deadlocking on `organization` FK checks (H8 / F9-1 / M3 / Astra #2).
 */
export async function lockContractDefaultsOrgExclusiveInTx(
	tx: PolicyTransaction,
	organizationId: string,
): Promise<void> {
	const orgLockKey = `contract_default_org:${organizationId}`;
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orgLockKey}))`);
	await tx.execute(sql`
		SELECT id
		FROM organization
		WHERE id = ${organizationId}
		FOR KEY SHARE
	`);
}

/**
 * Locks affected `employee` rows (level 2, `FOR KEY SHARE`) and active `work_policy_assignment`
 * rows (level 3, `FOR UPDATE`) in deterministic `id` order BEFORE locking `work_policy` (level 4),
 * matching `policy-clock-out-break-snapshot.ts` (`employee -> assignment -> policy`) so concurrent
 * deactivation, history-split FK checks, and clock-out can never deadlock (A3-13 / M4 / F10-2 / Astra #2).
 */
export async function lockPolicyAssignmentsForRetirementInTx(
	tx: PolicyTransaction,
	organizationId: string,
	policyId: string,
): Promise<void> {
	// Level (2): Pre-lock every employee with any terms pin (confirmed, draft, or pending) to this
	// policy FOR KEY SHARE before locking assignments so Step 1d never inverts (2) <-> (3) (F11-3).
	await tx.execute(sql`
		SELECT e.id
		FROM employee e
		WHERE e.organization_id = ${organizationId}
			AND EXISTS (
				SELECT 1
				FROM employee_employment_history h
				WHERE h.organization_id = e.organization_id
					AND h.employee_id = e.id
					AND h.work_policy_id = ${policyId}::uuid
			)
		ORDER BY e.id
		FOR KEY SHARE
	`);
	// Level (3): Lock active assignments for this policy in ascending id order.
	await tx.execute(sql`
		SELECT id
		FROM work_policy_assignment
		WHERE organization_id = ${organizationId}
			AND policy_id = ${policyId}::uuid
			AND is_active = true
		ORDER BY id
		FOR UPDATE
	`);
}

/**
 * Records a dated retirement boundary (`orgTodayDate`) on active `work_policy_assignment`,
 * unlinked confirmed `employee_employment_history` terms pins, departure-capped assignment
 * records, and active `contract_default` rows referencing a retired policy so historical dates
 * continue resolving the retired policy while today and future dates stop applying it without
 * losing non-policy fields or reviving retired pins on later reactivation
 * (A1-12 / A2-8 / P7-1 / P8-1 / P8-2 / A3-5 / A3-12 / A3-14 / H5 / H8 / M3 / M5 / M9 / F10-1 / F10-2).
 *
 * Callers MUST acquire `lockContractDefaultsOrgExclusiveInTx` -> `lockPolicyAssignmentsForRetirementInTx`
 * -> `work_policy FOR UPDATE` before invoking this helper.
 */
export async function retirePolicyReferencesInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		policyId: string;
		actorUserId: string;
		orgTodayDate: string;
		orgTimezone?: string;
		now: Date;
	},
): Promise<void> {
	const { organizationId, policyId, actorUserId, orgTodayDate, now } = input;
	const orgTimezone = input.orgTimezone ?? (await loadOrganizationTimezone(tx, organizationId));
	const orgTodayMidnight = utcMidnight(parsePlainDate(orgTodayDate));
	// A3-14 / M5: Legacy timestamp-bounded assignments are classified & capped against org-local
	// midnight so non-UTC organizations (e.g. America/New_York) never lose evening hours on the
	// prior local day even when migration stored `effective_from_date = orgTodayDate` from UTC midnight.
	const orgTodayLocalStart = dateFromInstant(
		parsePlainDate(orgTodayDate).toZonedDateTime(orgTimezone).toInstant(),
	);

	// 1a. Handle legacy timestamp-bounded assignments whose instant started strictly before
	//     orgTodayLocalStart even though `effective_from_date >= orgTodayDate` (M5).
	//     Shift `effective_from_date` to the org-local start date (< orgTodayDate) when non-overlapping
	//     so 0322's `effective_until_date > effective_from_date` and btree_gist constraints stay valid.
	await tx.execute(sql`
		UPDATE work_policy_assignment a
		SET effective_from_date = ((a.effective_from AT TIME ZONE 'UTC') AT TIME ZONE ${orgTimezone})::date,
			effective_until = (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'),
			effective_until_date = ${orgTodayDate}::date,
			updated_at = ${now}
		WHERE a.organization_id = ${organizationId}
			AND a.policy_id = ${policyId}::uuid
			AND a.is_active = true
			AND a.source_kind = 'legacy'
			AND a.effective_from IS NOT NULL
			AND a.effective_from < (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC')
			AND (a.effective_until IS NULL OR a.effective_until > (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'))
			AND a.effective_from_date >= ${orgTodayDate}::date
			AND ((a.effective_from AT TIME ZONE 'UTC') AT TIME ZONE ${orgTimezone})::date < ${orgTodayDate}::date
			AND NOT EXISTS (
				SELECT 1
				FROM work_policy_assignment other
				WHERE other.organization_id = a.organization_id
					AND other.assignment_type = a.assignment_type
					AND other.is_active = true
					AND other.id <> a.id
					AND (
						(a.assignment_type = 'organization')
						OR (a.assignment_type = 'team' AND other.team_id = a.team_id)
						OR (a.assignment_type = 'employee' AND other.employee_id = a.employee_id)
					)
					AND daterange(other.effective_from_date, other.effective_until_date, '[)')
						&& daterange(
							((a.effective_from AT TIME ZONE 'UTC') AT TIME ZONE ${orgTimezone})::date,
							${orgTodayDate}::date,
							'[)'
						)
			)
	`);

	// 1a-fallback (Astra M5): When a preceding assignment occupies the prior calendar date in
	// btree_gist (e.g., prev ends 2026-06-10 00:00Z, cur starts 2026-06-10 00:00Z in New York),
	// keep cur's `effective_from_date = orgTodayDate`, cap `effective_until = orgTodayLocalStart`,
	// and narrow `effective_until_date` to `orgTodayDate + 1` (a strict subset of cur's existing
	// range, satisfying 0322's `effective_until_date > effective_from_date` and btree_gist while
	// both clock-out and resolver evaluate legacy rows via `effective_until`!).
	await tx.execute(sql`
		UPDATE work_policy_assignment a
		SET effective_until = (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'),
			effective_until_date = (${orgTodayDate}::date + 1),
			updated_at = ${now}
		WHERE a.organization_id = ${organizationId}
			AND a.policy_id = ${policyId}::uuid
			AND a.is_active = true
			AND a.source_kind = 'legacy'
			AND a.effective_from IS NOT NULL
			AND a.effective_from < (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC')
			AND (a.effective_until IS NULL OR a.effective_until > (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'))
			AND a.effective_from_date = ${orgTodayDate}::date
	`);

	// 1b. Cap remaining active policy assignments spanning orgTodayDate / orgTodayLocalStart.
	await tx.execute(sql`
		UPDATE work_policy_assignment
		SET effective_until = CASE
				WHEN source_kind = 'legacy' THEN (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC')
				ELSE (${orgTodayMidnight}::timestamptz AT TIME ZONE 'UTC')
			END,
			effective_until_date = ${orgTodayDate}::date,
			updated_at = ${now}
		WHERE organization_id = ${organizationId}
			AND policy_id = ${policyId}::uuid
			AND is_active = true
			AND effective_from_date < ${orgTodayDate}::date
			AND (
				(
					source_kind <> 'legacy'
					AND (effective_until_date IS NULL OR effective_until_date > ${orgTodayDate}::date)
				)
				OR (
					source_kind = 'legacy'
					AND (effective_from IS NULL OR effective_from < (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'))
					AND (effective_until IS NULL OR effective_until > (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'))
				)
			)
	`);

	// 1c. Deactivate assignments that take effect on or after orgTodayDate / orgTodayLocalStart.
	await tx.execute(sql`
		UPDATE work_policy_assignment
		SET is_active = false, updated_at = ${now}
		WHERE organization_id = ${organizationId}
			AND policy_id = ${policyId}::uuid
			AND is_active = true
			AND (
				(source_kind <> 'legacy' AND effective_from_date >= ${orgTodayDate}::date)
				OR (
					source_kind = 'legacy'
					AND (
						(effective_from IS NOT NULL AND effective_from >= (${orgTodayLocalStart}::timestamptz AT TIME ZONE 'UTC'))
						OR (effective_from IS NULL AND effective_from_date >= ${orgTodayDate}::date)
					)
				)
			)
	`);

	// 1d-drafts (F11-3 / Astra #3): Clear retired policy pins from unconfirmed (draft/pending)
	// employment-history rows so confirming a stale draft later can never revive a retired policy.
	await tx.execute(sql`
		UPDATE employee_employment_history
		SET work_policy_id = NULL, updated_at = ${now}
		WHERE organization_id = ${organizationId}
			AND work_policy_id = ${policyId}::uuid
			AND review_state IN ('draft', 'pending')
	`);

	// 1d. H5 / F10-1 / Astra #1, #3, #4: Split or clear unlinked confirmed `employee_employment_history`
	//     terms pins referencing this policy (just like `contract_default` below) so historical dates
	//     before `orgTodayDate` keep resolving this policy (even when overlapping another manager
	//     assignment), today and future dates stop applying it, later reactivation never revives it,
	//     and already-superseded overlapping legacy rows are capped WITHOUT cloning stale wages (Astra #4).
	const unlinkedTerms = await tx
		.select({
			row: employeeEmploymentHistory,
			validFromDateIso: sql<string>`to_char(${employeeEmploymentHistory.validFromDate}, 'YYYY-MM-DD')`,
			validUntilDateIso: sql<
				string | null
			>`to_char(${employeeEmploymentHistory.validUntilDate}, 'YYYY-MM-DD')`,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, organizationId),
				eq(employeeEmploymentHistory.workPolicyId, policyId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				sql`(${employeeEmploymentHistory.validUntilDate} IS NULL OR ${employeeEmploymentHistory.validUntilDate} > ${orgTodayDate}::date)`,
				sql`NOT EXISTS (
					SELECT 1
					FROM work_policy_assignment a
					WHERE a.organization_id = ${employeeEmploymentHistory.organizationId}
						AND a.assignment_type = 'employee'
						AND a.employee_id = ${employeeEmploymentHistory.employeeId}
						AND a.policy_id = ${employeeEmploymentHistory.workPolicyId}
						AND a.source_employment_history_id = ${employeeEmploymentHistory.id}
				)`,
			),
		)
		.orderBy(asc(employeeEmploymentHistory.id));

	for (const { row: term, validFromDateIso, validUntilDateIso } of unlinkedTerms) {
		const fromDate =
			validFromDateIso || plainDateAt(instantFromDate(term.validFrom), orgTimezone).toString();
		if (fromDate >= orgTodayDate) {
			await tx
				.update(employeeEmploymentHistory)
				.set({
					workPolicyId: null,
					updatedAt: now,
				})
				.where(
					and(
						eq(employeeEmploymentHistory.id, term.id),
						eq(employeeEmploymentHistory.organizationId, organizationId),
					),
				);
			continue;
		}

		// Astra #4: Check whether a newer non-empty confirmed terms row already supersedes `term`
		// on or before `orgTodayDate` (possible for legacy `employment_period_id IS NULL` rows).
		// If already superseded, cap `term` without inserting a continuation row so stale wages/terms
		// can never overtake the newer winning row!
		const supersedingRes = await tx.execute(sql`
			SELECT
				MIN(to_char(newer.valid_from_date, 'YYYY-MM-DD')) FILTER (
					WHERE (
						(${term.employmentPeriodId !== null} AND newer.employment_period_id = ${term.employmentPeriodId}::uuid)
						OR (${term.employmentPeriodId === null} AND newer.employment_period_id IS NULL)
					)
					AND (
						newer.valid_from_date > ${fromDate}::date
						OR (
							newer.valid_from_date = ${fromDate}::date
							AND (
								newer.created_at > ${term.createdAt}
								OR (newer.created_at = ${term.createdAt} AND newer.id > ${term.id}::uuid)
							)
						)
					)
				) AS "sameScopeSupersedingFromDate",
				EXISTS (
					SELECT 1
					FROM employee_employment_period open_p
					JOIN employee_employment_history ps
						ON ps.organization_id = open_p.organization_id
						AND ps.employee_id = open_p.employee_id
						AND ps.employment_period_id = open_p.id
					WHERE open_p.organization_id = ${organizationId}
						AND open_p.employee_id = ${term.employeeId}::uuid
						AND open_p.status = 'open'
						AND ps.review_state = 'confirmed'
						AND (ps.valid_until_date IS NULL OR ps.valid_until_date > ps.valid_from_date)
				) AS "hasOpenPeriodScopedTerms"
			FROM employee_employment_history newer
			WHERE newer.organization_id = ${organizationId}
				AND newer.employee_id = ${term.employeeId}::uuid
				AND newer.review_state = 'confirmed'
				AND newer.id <> ${term.id}::uuid
				AND (newer.valid_until_date IS NULL OR newer.valid_until_date > newer.valid_from_date)
		`);
		const supRow = toRows(supersedingRes)[0] as
			| {
					sameScopeSupersedingFromDate: string | null;
					hasOpenPeriodScopedTerms: boolean;
			  }
			| undefined;
		const supersedingFromDate = supRow?.sameScopeSupersedingFromDate ?? null;
		const supersededByPeriodScoped =
			term.employmentPeriodId === null && Boolean(supRow?.hasOpenPeriodScopedTerms);

		if (supersedingFromDate !== null && supersedingFromDate <= orgTodayDate) {
			if (supersedingFromDate <= fromDate) {
				await tx
					.update(employeeEmploymentHistory)
					.set({ workPolicyId: null, updatedAt: now })
					.where(
						and(
							eq(employeeEmploymentHistory.id, term.id),
							eq(employeeEmploymentHistory.organizationId, organizationId),
						),
					);
			} else {
				const capDate =
					validUntilDateIso !== null && validUntilDateIso < supersedingFromDate
						? validUntilDateIso
						: supersedingFromDate;
				await tx
					.update(employeeEmploymentHistory)
					.set({
						validUntilDate: capDate,
						validUntil: utcMidnight(parsePlainDate(capDate)),
						updatedAt: now,
					})
					.where(
						and(
							eq(employeeEmploymentHistory.id, term.id),
							eq(employeeEmploymentHistory.organizationId, organizationId),
						),
					);
			}
			continue;
		}

		if (supersededByPeriodScoped) {
			await tx
				.update(employeeEmploymentHistory)
				.set({
					validUntilDate: orgTodayDate,
					validUntil: orgTodayMidnight,
					updatedAt: now,
				})
				.where(
					and(
						eq(employeeEmploymentHistory.id, term.id),
						eq(employeeEmploymentHistory.organizationId, organizationId),
					),
				);
			continue;
		}

		// Cap historical terms segment at orgTodayDate and insert continuation without the retired policy.
		await tx
			.update(employeeEmploymentHistory)
			.set({
				validUntilDate: orgTodayDate,
				validUntil: orgTodayMidnight,
				updatedAt: now,
			})
			.where(
				and(
					eq(employeeEmploymentHistory.id, term.id),
					eq(employeeEmploymentHistory.organizationId, organizationId),
				),
			);

		const continuationUntilDate =
			supersedingFromDate !== null &&
			(validUntilDateIso === null || supersedingFromDate < validUntilDateIso)
				? supersedingFromDate
				: validUntilDateIso;
		const continuationUntilTs =
			continuationUntilDate !== null
				? continuationUntilDate === validUntilDateIso && term.validUntil !== null
					? term.validUntil
					: utcMidnight(parsePlainDate(continuationUntilDate))
				: null;

		const [continuation] = await tx
			.insert(employeeEmploymentHistory)
			.values({
				employeeId: term.employeeId,
				organizationId: term.organizationId,
				employmentPeriodId: term.employmentPeriodId,
				validFrom: orgTodayMidnight,
				validUntil: continuationUntilTs,
				validFromDate: orgTodayDate,
				validUntilDate: continuationUntilDate,
				status: term.status,
				contractType: term.contractType,
				weeklyContractMinutes: term.weeklyContractMinutes,
				probationStartsOn: term.probationStartsOn,
				probationEndsOn: term.probationEndsOn,
				workModel: term.workModel,
				workPolicyId: null,
				scheduleMode: term.scheduleMode,
				presenceOverride: term.presenceOverride,
				balanceMode: term.balanceMode,
				scheduleSource: term.scheduleSource,
				sourceTemplateVersionId: term.sourceTemplateVersionId,
				sourceBatchItemId: null,
				employmentProfile: term.employmentProfile,
				arbzgScope: term.arbzgScope,
				onCallHoursKind: term.onCallHoursKind,
				onCallWeeklyMinutes: term.onCallWeeklyMinutes,
				onCallDailyMinutes: term.onCallDailyMinutes,
				migratedLegacyTerms: term.migratedLegacyTerms,
				hourlyRate: term.hourlyRate,
				currency: term.currency,
				reviewState: term.reviewState,
				changeReason: term.changeReason,
				createdBy: actorUserId,
				createdAt: now,
				updatedBy: actorUserId,
				updatedAt: now,
			})
			.returning({ id: employeeEmploymentHistory.id });

		if (continuation) {
			const existingCustomDays = await tx
				.select()
				.from(employeeEmploymentHistoryDay)
				.where(
					and(
						eq(employeeEmploymentHistoryDay.organizationId, organizationId),
						eq(employeeEmploymentHistoryDay.employmentHistoryId, term.id),
					),
				);
			if (existingCustomDays.length > 0) {
				await tx.insert(employeeEmploymentHistoryDay).values(
					existingCustomDays.map((d) => ({
						organizationId,
						employmentHistoryId: continuation.id,
						dayOfWeek: d.dayOfWeek,
						minutesPerDay: d.minutesPerDay,
						isWorkDay: d.isWorkDay,
						latestClockIn: d.latestClockIn,
					})),
				);
			}
		}
	}

	// 1e. Astra #4 / M9: Record an append-only durable retirement boundary in `audit_log`
	//     capturing `orgTodayDate` in the organization's timezone at retirement so a later policy
	//     rename or reactivation before a forward departure correction can never extend past this
	//     retirement (and without mutating append-only `employee_departure_event` or locking `employee`).
	await tx.insert(auditLog).values({
		organizationId,
		entityType: "work_policy",
		entityId: policyId,
		action: "work_policy.retired",
		performedBy: actorUserId,
		employeeId: null,
		metadata: JSON.stringify({
			retiredOnDate: orgTodayDate,
			retiredAtLocalStart: orgTodayLocalStart.toISOString(),
			retiredAtUtcMidnight: orgTodayMidnight.toISOString(),
			organizationTimezone: orgTimezone,
		}),
		timestamp: now,
	});

	// 2. Query ONLY active contract_default rows referencing this policy (under the org-wide
	//    contract_default_org exclusive lock acquired before assignment & policy locks) so
	//    superseded/inactive defaults are never revived and no new scope can race in (P8-1 / H8 / M3).
	const defaultRows = await tx
		.select({
			defaultRow: contractDefault,
			version: contractTemplateVersion,
		})
		.from(contractDefault)
		.innerJoin(
			contractTemplateVersion,
			and(
				eq(contractTemplateVersion.id, contractDefault.templateVersionId),
				eq(contractTemplateVersion.organizationId, contractDefault.organizationId),
			),
		)
		.where(
			and(
				eq(contractDefault.organizationId, organizationId),
				eq(contractDefault.isActive, true),
				eq(contractTemplateVersion.workPolicyId, policyId),
			),
		);

	for (const { defaultRow, version } of defaultRows) {
		if (defaultRow.effectiveUntilDate !== null && defaultRow.effectiveUntilDate <= orgTodayDate) {
			continue;
		}
		const maxVerRes = await tx.execute(sql`
			SELECT COALESCE(MAX(version_number), 0)::int AS max_ver
			FROM contract_template_version
			WHERE organization_id = ${organizationId}
				AND template_id = ${version.templateId}::uuid
		`);
		const nextVersionNumber = Number(toRows(maxVerRes)[0]?.max_ver ?? 0) + 1;

		const [clonedVersion] = await tx
			.insert(contractTemplateVersion)
			.values({
				organizationId,
				templateId: version.templateId,
				versionNumber: nextVersionNumber,
				workPolicyId: null,
				weeklyContractMinutes: version.weeklyContractMinutes,
				scheduleMode: version.scheduleMode,
				workModel: version.workModel,
				presenceOverride: version.presenceOverride,
				balanceMode: version.balanceMode,
				scheduleSource: version.scheduleSource,
				defaultContractType: version.defaultContractType,
				defaultHourlyRate: version.defaultHourlyRate,
				defaultCurrency: version.defaultCurrency,
				defaultEmploymentProfile: version.defaultEmploymentProfile,
				defaultArbzgScope: version.defaultArbzgScope,
				defaultOnCallHoursKind: version.defaultOnCallHoursKind,
				defaultOnCallWeeklyMinutes: version.defaultOnCallWeeklyMinutes,
				defaultOnCallDailyMinutes: version.defaultOnCallDailyMinutes,
				createdBy: actorUserId,
				createdAt: now,
			})
			.returning({ id: contractTemplateVersion.id });
		if (!clonedVersion) continue;

		const existingDays = await tx
			.select()
			.from(contractTemplateVersionDay)
			.where(
				and(
					eq(contractTemplateVersionDay.organizationId, organizationId),
					eq(contractTemplateVersionDay.templateVersionId, version.id),
				),
			);
		if (existingDays.length > 0) {
			await tx.insert(contractTemplateVersionDay).values(
				existingDays.map((d) => ({
					organizationId,
					templateVersionId: clonedVersion.id,
					dayOfWeek: d.dayOfWeek,
					minutesPerDay: d.minutesPerDay,
					isWorkDay: d.isWorkDay,
					latestClockIn: d.latestClockIn,
				})),
			);
		}

		if (defaultRow.effectiveFromDate >= orgTodayDate) {
			await tx
				.update(contractDefault)
				.set({
					templateVersionId: clonedVersion.id,
					updatedBy: actorUserId,
					updatedAt: now,
				})
				.where(
					and(
						eq(contractDefault.id, defaultRow.id),
						eq(contractDefault.organizationId, organizationId),
					),
				);
		} else {
			// Cap historical segment at orgTodayDate and insert continuation without the retired policy.
			await tx
				.update(contractDefault)
				.set({
					effectiveUntilDate: orgTodayDate,
					updatedBy: actorUserId,
					updatedAt: now,
				})
				.where(
					and(
						eq(contractDefault.id, defaultRow.id),
						eq(contractDefault.organizationId, organizationId),
					),
				);
			await tx.insert(contractDefault).values({
				organizationId,
				scope: defaultRow.scope,
				teamId: defaultRow.teamId,
				templateVersionId: clonedVersion.id,
				requireDefaultEligible: true,
				effectiveFromDate: orgTodayDate,
				effectiveUntilDate: defaultRow.effectiveUntilDate,
				isActive: true,
				createdBy: actorUserId,
				createdAt: now,
				updatedBy: actorUserId,
				updatedAt: now,
			});
		}
	}
}

async function lockWorkPolicyForUpdateInTx(
	tx: PolicyTransaction,
	organizationId: string,
	policyId: string,
): Promise<typeof workPolicy.$inferSelect | null> {
	const result = await tx.execute(sql`
		SELECT
			"id",
			"organization_id" AS "organizationId",
			"name",
			"description",
			"schedule_enabled" AS "scheduleEnabled",
			"regulation_enabled" AS "regulationEnabled",
			"presence_enabled" AS "presenceEnabled",
			"is_active" AS "isActive",
			"is_default" AS "isDefault",
			"created_at" AS "createdAt",
			"created_by" AS "createdBy",
			"updated_at" AS "updatedAt",
			"updated_by" AS "updatedBy"
		FROM "work_policy"
		WHERE "id" = ${policyId}::uuid
			AND "organization_id" = ${organizationId}
		FOR UPDATE
	`);
	const row = toRows(result)[0];
	if (!row || typeof row.id !== "string") return null;
	return row as unknown as typeof workPolicy.$inferSelect;
}

/** Reads `work_policy_versioning_state.sealed_cutover_at` strictly AFTER acquiring locks. */
export async function readSealedCutoverAtInTx(tx: PolicyTransaction): Promise<Date | null> {
	const result = await tx.execute(sql`
		SELECT "sealed_cutover_at" AS "sealedCutoverAt"
		FROM "work_policy_versioning_state"
		WHERE "singleton" = true
		LIMIT 1
	`);
	const raw = toRows(result)[0]?.sealedCutoverAt;
	if (!raw) return null;
	return raw instanceof Date ? raw : new Date(String(raw));
}

async function listPolicyVersionsOrderedInTx(
	tx: PolicyTransaction,
	policyId: string,
): Promise<PolicyVersionSummary[]> {
	const result = await tx.execute(sql`
		SELECT
			"id",
			"version_number" AS "versionNumber",
			to_char("effective_from_date", 'YYYY-MM-DD') AS "effectiveFromDate",
			"schedule_enabled" AS "scheduleEnabled",
			"regulation_enabled" AS "regulationEnabled",
			"presence_enabled" AS "presenceEnabled",
			"sealed_at" AS "sealedAt"
		FROM "work_policy_version"
		WHERE "policy_id" = ${policyId}::uuid
		ORDER BY "effective_from_date" DESC, "version_number" DESC
	`);
	return toRows(result).map(parseVersionSummaryRow);
}

/**
 * Obtains version 1 idempotently (`INSERT ... ON CONFLICT DO NOTHING` + `SELECT id`),
 * working cleanly pre-`0326` (bridge trigger already inserted v1), parked at `0326`
 * (bridge trigger dropped, `sealed_cutover_at IS NULL`), and post-`0327`.
 */
async function ensurePolicyV1IdempotentlyInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		policyId: string;
		effectiveFromDate: string;
		scheduleEnabled: boolean;
		regulationEnabled: boolean;
		presenceEnabled: boolean;
		createdBy: string;
	},
): Promise<PolicyVersionSummary> {
	await tx.execute(sql`
		INSERT INTO "work_policy_version" (
			"organization_id",
			"policy_id",
			"version_number",
			"effective_from_date",
			"schedule_enabled",
			"regulation_enabled",
			"presence_enabled",
			"is_legacy_baseline",
			"sealed_at",
			"created_by"
		)
		VALUES (
			${input.organizationId},
			${input.policyId}::uuid,
			1,
			${input.effectiveFromDate}::date,
			${input.scheduleEnabled},
			${input.regulationEnabled},
			${input.presenceEnabled},
			false,
			NULL,
			${input.createdBy}
		)
		ON CONFLICT ("policy_id", "version_number") DO NOTHING
	`);

	const selected = await tx.execute(sql`
		SELECT
			"id",
			"version_number" AS "versionNumber",
			to_char("effective_from_date", 'YYYY-MM-DD') AS "effectiveFromDate",
			"schedule_enabled" AS "scheduleEnabled",
			"regulation_enabled" AS "regulationEnabled",
			"presence_enabled" AS "presenceEnabled",
			"sealed_at" AS "sealedAt"
		FROM "work_policy_version"
		WHERE "policy_id" = ${input.policyId}::uuid
			AND "version_number" = 1
		LIMIT 1
	`);
	const row = toRows(selected)[0];
	if (!row) {
		throw new NotFoundError({
			message: "Failed to resolve work policy version 1",
			entityType: "work_policy_version",
			entityId: input.policyId,
		});
	}
	return parseVersionSummaryRow(row);
}

async function sealPolicyVersionAsFinalStatementInTx(
	tx: PolicyTransaction,
	versionId: string,
): Promise<Date> {
	const result = await tx.execute(sql`
		UPDATE "work_policy_version"
		SET "sealed_at" = now()
		WHERE "id" = ${versionId}::uuid
			AND "sealed_at" IS NULL
		RETURNING "sealed_at" AS "sealedAt"
	`);
	const raw = toRows(result)[0]?.sealedAt;
	return raw instanceof Date ? raw : raw ? new Date(String(raw)) : currentTimestamp();
}

async function insertScheduleForVersionInTx(
	tx: PolicyTransaction,
	policyId: string,
	policyVersionId: string,
	schedule: PolicyScheduleInput,
) {
	const [created] = await tx
		.insert(workPolicySchedule)
		.values({
			policyId,
			policyVersionId,
			scheduleCycle: schedule.scheduleCycle,
			scheduleType: schedule.scheduleType,
			workingDaysPreset:
				schedule.scheduleType === "detailed" ? "custom" : schedule.workingDaysPreset,
			hoursPerCycle: schedule.scheduleType === "simple" ? schedule.hoursPerCycle : null,
			homeOfficeDaysPerCycle: schedule.homeOfficeDaysPerCycle ?? 0,
			updatedAt: currentTimestamp(),
		})
		.returning();

	const days = schedule.days;
	if (days && days.length > 0) {
		await tx.insert(workPolicyScheduleDay).values(
			days.map((day) => ({
				scheduleId: created.id,
				policyVersionId,
				dayOfWeek: day.dayOfWeek,
				hoursPerDay: day.hoursPerDay,
				isWorkDay: day.isWorkDay,
				cycleWeek: day.cycleWeek ?? 1,
				latestClockIn: latestClockInForDay(day),
			})),
		);
	}
}

async function insertBreakRulesForVersionInTx(
	tx: PolicyTransaction,
	regulationId: string,
	policyVersionId: string,
	breakRules: PolicyBreakRuleInput[],
) {
	for (const [ruleIndex, rule] of breakRules.entries()) {
		const [breakRule] = await tx
			.insert(workPolicyBreakRule)
			.values({
				regulationId,
				policyVersionId,
				workingMinutesThreshold: rule.workingMinutesThreshold,
				requiredBreakMinutes: rule.requiredBreakMinutes,
				sortOrder: ruleIndex,
				updatedAt: currentTimestamp(),
			})
			.returning();

		for (const [optIndex, option] of rule.options.entries()) {
			await tx.insert(workPolicyBreakOption).values({
				breakRuleId: breakRule.id,
				policyVersionId,
				splitCount: option.splitCount,
				minimumSplitMinutes: option.minimumSplitMinutes,
				minimumLongestSplitMinutes: option.minimumLongestSplitMinutes,
				sortOrder: optIndex,
			});
		}
	}
}

async function insertRegulationForVersionInTx(
	tx: PolicyTransaction,
	policyId: string,
	policyVersionId: string,
	regulation: PolicyRegulationInput,
	existingRegulation: typeof workPolicyRegulation.$inferSelect | null,
) {
	const [created] = await tx
		.insert(workPolicyRegulation)
		.values({
			policyId,
			policyVersionId,
			...resolveRegulationValues(regulation, existingRegulation),
			updatedAt: currentTimestamp(),
		})
		.returning();

	await insertBreakRulesForVersionInTx(tx, created.id, policyVersionId, regulation.breakRules);
}

async function upsertRegulationForUnsealedV1InTx(
	tx: PolicyTransaction,
	policyId: string,
	policyVersionId: string,
	regulation: PolicyRegulationInput,
	existingRegulation: typeof workPolicyRegulation.$inferSelect | null,
) {
	if (!existingRegulation) {
		await insertRegulationForVersionInTx(tx, policyId, policyVersionId, regulation, null);
		return;
	}

	await tx
		.update(workPolicyRegulation)
		.set({
			policyVersionId,
			...resolveRegulationValues(regulation, existingRegulation),
			updatedAt: currentTimestamp(),
		})
		.where(eq(workPolicyRegulation.id, existingRegulation.id));

	await tx
		.delete(workPolicyBreakRule)
		.where(eq(workPolicyBreakRule.regulationId, existingRegulation.id));

	await insertBreakRulesForVersionInTx(
		tx,
		existingRegulation.id,
		policyVersionId,
		regulation.breakRules,
	);
}

async function insertPresenceForVersionInTx(
	tx: PolicyTransaction,
	policyId: string,
	policyVersionId: string,
	presence: PolicyPresenceInput,
) {
	await tx.insert(workPolicyPresence).values({
		policyId,
		policyVersionId,
		presenceMode: presence.presenceMode,
		requiredOnsiteDays: presence.requiredOnsiteDays ?? null,
		requiredOnsiteFixedDays: presence.requiredOnsiteFixedDays
			? JSON.stringify(presence.requiredOnsiteFixedDays)
			: null,
		locationId: presence.locationId || null,
		evaluationPeriod: presence.evaluationPeriod ?? "weekly",
		enforcement: presence.enforcement ?? "warn",
		updatedAt: currentTimestamp(),
	});
}

/**
 * Loads a policy's children scoped strictly to a specific `policyVersionId`
 * (or the latest version ordered by `effective_from_date DESC, version_number DESC`).
 */
export async function loadWorkPolicyVersionDetailsInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		policyId: string;
		policyVersionId?: string;
	},
): Promise<VersionedWorkPolicyDetails | null> {
	const [policyRow] = await tx
		.select()
		.from(workPolicy)
		.where(
			and(eq(workPolicy.id, input.policyId), eq(workPolicy.organizationId, input.organizationId)),
		)
		.limit(1);

	if (!policyRow) return null;

	const versions = await tx
		.select()
		.from(workPolicyVersion)
		.where(
			and(
				eq(workPolicyVersion.policyId, input.policyId),
				eq(workPolicyVersion.organizationId, input.organizationId),
			),
		)
		.orderBy(desc(workPolicyVersion.effectiveFromDate), desc(workPolicyVersion.versionNumber));

	const targetVersion = input.policyVersionId
		? (versions.find((v) => v.id === input.policyVersionId) ?? versions[0])
		: versions[0];

	const scheduleRow = targetVersion
		? (
				await tx
					.select()
					.from(workPolicySchedule)
					.where(eq(workPolicySchedule.policyVersionId, targetVersion.id))
					.limit(1)
			)[0]
		: (
				await tx
					.select()
					.from(workPolicySchedule)
					.where(eq(workPolicySchedule.policyId, input.policyId))
					.limit(1)
			)[0];

	const scheduleDays = scheduleRow
		? await tx
				.select()
				.from(workPolicyScheduleDay)
				.where(eq(workPolicyScheduleDay.scheduleId, scheduleRow.id))
		: [];

	const regulationRow = targetVersion
		? (
				await tx
					.select()
					.from(workPolicyRegulation)
					.where(eq(workPolicyRegulation.policyVersionId, targetVersion.id))
					.limit(1)
			)[0]
		: (
				await tx
					.select()
					.from(workPolicyRegulation)
					.where(eq(workPolicyRegulation.policyId, input.policyId))
					.limit(1)
			)[0];

	const breakRuleRows = regulationRow
		? await tx
				.select()
				.from(workPolicyBreakRule)
				.where(eq(workPolicyBreakRule.regulationId, regulationRow.id))
				.orderBy(asc(workPolicyBreakRule.sortOrder))
		: [];

	const breakRuleIds = breakRuleRows.map((r) => r.id);
	const breakOptionRows =
		breakRuleIds.length > 0
			? await tx
					.select()
					.from(workPolicyBreakOption)
					.where(inArray(workPolicyBreakOption.breakRuleId, breakRuleIds))
					.orderBy(asc(workPolicyBreakOption.sortOrder))
			: [];

	const optionsByRule = new Map<string, (typeof workPolicyBreakOption.$inferSelect)[]>();
	for (const opt of breakOptionRows) {
		const list = optionsByRule.get(opt.breakRuleId) ?? [];
		list.push(opt);
		optionsByRule.set(opt.breakRuleId, list);
	}

	const presenceRow = targetVersion
		? (
				await tx
					.select()
					.from(workPolicyPresence)
					.where(eq(workPolicyPresence.policyVersionId, targetVersion.id))
					.limit(1)
			)[0]
		: (
				await tx
					.select()
					.from(workPolicyPresence)
					.where(eq(workPolicyPresence.policyId, input.policyId))
					.limit(1)
			)[0];

	return {
		...policyRow,
		scheduleEnabled: targetVersion?.scheduleEnabled ?? policyRow.scheduleEnabled,
		regulationEnabled: targetVersion?.regulationEnabled ?? policyRow.regulationEnabled,
		presenceEnabled: targetVersion?.presenceEnabled ?? policyRow.presenceEnabled,
		schedule: scheduleRow ? { ...scheduleRow, days: scheduleDays } : null,
		regulation: regulationRow
			? {
					...regulationRow,
					breakRules: breakRuleRows.map((rule) => ({
						...rule,
						options: optionsByRule.get(rule.id) ?? [],
					})),
				}
			: null,
		presence: presenceRow ?? null,
	};
}

/**
 * DB-state-driven version-aware work policy creation.
 * Works cleanly pre-`0326`, parked at `0326`, and post-`0327`.
 */
export async function createVersionedWorkPolicyInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		data: CreateVersionedPolicyInput;
	},
): Promise<{ policy: VersionedWorkPolicyDetails; version: PolicyVersionSummary }> {
	const { organizationId, actorUserId, data } = input;

	if (!data.scheduleEnabled && !data.regulationEnabled && !data.presenceEnabled) {
		throw new ValidationError({
			message: "At least one feature (schedule, regulation, or presence) must be enabled",
			field: "scheduleEnabled",
		});
	}
	if (data.schedule?.days && !hasValidLatestClockIns(data.schedule.days)) {
		throw new ValidationError({
			message: "Latest clock-in must be a time between 00:00 and 23:59",
			field: "schedule.days.latestClockIn",
		});
	}
	const effectiveFromDate = normalizeDateInput(data.effectiveFromDate) ?? "1970-01-01";

	const existingPolicy = await tx.query.workPolicy.findFirst({
		where: and(
			eq(workPolicy.organizationId, organizationId),
			eq(workPolicy.name, data.name),
			eq(workPolicy.isActive, true),
		),
	});
	if (existingPolicy) {
		throw new ConflictError({
			message: "A policy with this name already exists",
			conflictType: "duplicate_name",
			details: { entityType: "work_policy", field: "name" },
		});
	}

	// Step 1: Insert work_policy (acquires exclusive row lock on the new policy row first).
	const [newPolicy] = await tx
		.insert(workPolicy)
		.values({
			organizationId,
			name: data.name,
			description: data.description,
			scheduleEnabled: data.scheduleEnabled,
			regulationEnabled: data.regulationEnabled,
			presenceEnabled: data.presenceEnabled ?? false,
			createdBy: actorUserId,
			updatedAt: currentTimestamp(),
		})
		.returning();

	// Step 2: Validate tenant ownership (and active status when enabled) for every presence
	// location being persisted, including when presence is disabled (A2-5).
	const presenceLocationId = data.presence?.locationId || null;
	if (presenceLocationId) {
		await lockOwnedLocationForShareInTx(
			tx,
			organizationId,
			presenceLocationId,
			Boolean(data.presenceEnabled),
		);
	}

	// Step 3: Strictly AFTER acquiring locks, read versioning cutover state.
	const sealedCutoverAt = await readSealedCutoverAtInTx(tx);

	// Step 4: Obtain v1 idempotently (works pre-0326, parked-0326, and post-0327).
	let v1 = await ensurePolicyV1IdempotentlyInTx(tx, {
		organizationId,
		policyId: newPolicy.id,
		effectiveFromDate,
		scheduleEnabled: data.scheduleEnabled,
		regulationEnabled: data.regulationEnabled,
		presenceEnabled: data.presenceEnabled ?? false,
		createdBy: actorUserId,
	});

	// Step 5: Insert children with explicit policyVersionId independently of enablement flags
	// so saved child rules are retained across toggles and duplications (Spec #1921 Story 12 / A1-14).
	if (data.schedule) {
		await insertScheduleForVersionInTx(tx, newPolicy.id, v1.id, data.schedule);
	}
	if (data.regulation) {
		await insertRegulationForVersionInTx(tx, newPolicy.id, v1.id, data.regulation, null);
	}
	if (data.presence) {
		await insertPresenceForVersionInTx(tx, newPolicy.id, v1.id, data.presence);
	}

	const saved = await loadWorkPolicyVersionDetailsInTx(tx, {
		organizationId,
		policyId: newPolicy.id,
		policyVersionId: v1.id,
	});
	if (!saved) {
		throw new NotFoundError({
			message: "Failed to fetch created policy",
			entityType: "work_policy",
		});
	}

	// Step 6 (post-0327): Seal v1 as the FINAL statement of the transaction.
	if (sealedCutoverAt !== null && v1.sealedAt === null) {
		const sealedAt = await sealPolicyVersionAsFinalStatementInTx(tx, v1.id);
		v1 = { ...v1, sealedAt };
	}

	return { policy: saved, version: v1 };
}

function isMetadataOnlyEdit(
	existing: typeof workPolicy.$inferSelect,
	data: UpdateVersionedPolicyInput,
): boolean {
	if (
		data.schedule !== undefined ||
		data.regulation !== undefined ||
		data.presence !== undefined ||
		data.effectiveFromDate !== undefined
	) {
		return false;
	}
	if (data.scheduleEnabled !== undefined && data.scheduleEnabled !== existing.scheduleEnabled) {
		return false;
	}
	if (
		data.regulationEnabled !== undefined &&
		data.regulationEnabled !== existing.regulationEnabled
	) {
		return false;
	}
	if (data.presenceEnabled !== undefined && data.presenceEnabled !== existing.presenceEnabled) {
		return false;
	}
	return true;
}

/**
 * DB-state-driven version-aware work policy edit / version publish.
 * - Acquires `work_policy FOR UPDATE` first, then `location FOR SHARE` (if presence location referenced).
 * - Metadata-only edits (`name`, `description`, `isActive`) update `work_policy` in place without creating versions.
 * - Pre-cutover (`sealed_at IS NULL` & `sealed_cutover_at IS NULL`): dual-writes the 3 enablement flags
 *   to both `work_policy` and unsealed v1 and updates children in place preserving all 7 ArbZG columns.
 * - Post-cutover (`sealed_at IS NOT NULL` or `sealed_cutover_at IS NOT NULL`): inserts a new unsealed
 *   `work_policy_version`, inserts all 6 child/grandchild sets referencing `policy_version_id`, and seals
 *   the new version as the final statement of the transaction.
 */
export async function updateOrPublishWorkPolicyInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		policyId: string;
		data: UpdateVersionedPolicyInput;
		forceNewVersion?: boolean;
		now?: Date;
	},
): Promise<PublishWorkPolicyVersionResult> {
	const { organizationId, actorUserId, policyId, data } = input;

	if (data.schedule?.days && !hasValidLatestClockIns(data.schedule.days)) {
		throw new ValidationError({
			message: "Latest clock-in must be a time between 00:00 and 23:59",
			field: "schedule.days.latestClockIn",
		});
	}
	const requestedEffectiveFromDate = normalizeDateInput(data.effectiveFromDate);

	// Step 1: When retiring (isActive: false), acquire locks in universal deadlock-free order:
	// (0) org defaults advisory lock (EXCLUSIVE) -> (3) active policy assignments ORDER BY id -> (4) work_policy (H8 / M3 / M4).
	if (data.isActive === false) {
		await lockContractDefaultsOrgExclusiveInTx(tx, organizationId);
		await lockPolicyAssignmentsForRetirementInTx(tx, organizationId, policyId);
	}
	const existingPolicy = await lockWorkPolicyForUpdateInTx(tx, organizationId, policyId);
	if (!existingPolicy) {
		throw new NotFoundError({
			message: "Policy not found",
			entityType: "work_policy",
			entityId: policyId,
		});
	}

	if (data.name && data.name !== existingPolicy.name) {
		const duplicatePolicy = await tx.query.workPolicy.findFirst({
			where: and(
				eq(workPolicy.organizationId, organizationId),
				eq(workPolicy.name, data.name),
				eq(workPolicy.isActive, true),
			),
		});
		if (duplicatePolicy && duplicatePolicy.id !== policyId) {
			throw new ConflictError({
				message: "A policy with this name already exists",
				conflictType: "duplicate_name",
				details: { entityType: "work_policy", field: "name" },
			});
		}
	}

	// Step 2: Metadata-only edit updates work_policy in place without creating empty versions.
	if (!input.forceNewVersion && isMetadataOnlyEdit(existingPolicy, data)) {
		const versions = await listPolicyVersionsOrderedInTx(tx, policyId);
		const now = input.now ?? currentTimestamp();
		const orgTimezone =
			data.isActive !== undefined && data.isActive !== existingPolicy.isActive
				? await loadOrganizationTimezone(tx, organizationId)
				: null;
		const orgTodayDate = orgTimezone
			? plainDateAt(instantFromDate(now), orgTimezone).toString()
			: null;

		// A1-30: Reactivating an inactive policy must lock & validate presence locations on effective
		// and future presence-enabled versions so an active policy can never point at an archived location.
		if (data.isActive === true && !existingPolicy.isActive && orgTodayDate) {
			await validateReactivationPresenceLocationsInTx(tx, {
				organizationId,
				policyId,
				versions,
				orgTodayDate,
			});
		}

		await tx
			.update(workPolicy)
			.set({
				name: data.name ?? existingPolicy.name,
				description: data.description ?? existingPolicy.description,
				isActive: data.isActive ?? existingPolicy.isActive,
				updatedBy: actorUserId,
				updatedAt: now,
			})
			.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));

		if (data.isActive === false && existingPolicy.isActive && orgTodayDate) {
			await retirePolicyReferencesInTx(tx, {
				organizationId,
				policyId,
				actorUserId,
				orgTodayDate,
				orgTimezone: orgTimezone ?? undefined,
				now,
			});
		}

		const latestVersion =
			versions[0] ??
			(await ensurePolicyV1IdempotentlyInTx(tx, {
				organizationId,
				policyId,
				effectiveFromDate: "1970-01-01",
				scheduleEnabled: existingPolicy.scheduleEnabled,
				regulationEnabled: existingPolicy.regulationEnabled,
				presenceEnabled: existingPolicy.presenceEnabled,
				createdBy: actorUserId,
			}));
		const saved = await loadWorkPolicyVersionDetailsInTx(tx, {
			organizationId,
			policyId,
			policyVersionId: latestVersion.id,
		});
		if (!saved) {
			throw new NotFoundError({
				message: "Failed to fetch updated policy",
				entityType: "work_policy",
			});
		}
		return {
			policy: saved,
			version: latestVersion,
			replacesSameDayVersion: null,
			laterScheduledVersions: [],
			metadataOnly: true,
		};
	}

	const orgTimezone = await loadOrganizationTimezone(tx, organizationId);
	const nowInstant = input.now ? instantFromDate(input.now) : systemClock.nowInstant();
	const orgTodayDate = plainDateAt(nowInstant, orgTimezone).toString();
	const targetEffectiveFromDate = requestedEffectiveFromDate ?? orgTodayDate;

	const selectBaseVersionForDate = (
		orderedVersions: PolicyVersionSummary[],
		targetDate: string,
	): PolicyVersionSummary | null =>
		orderedVersions.find((v) => v.effectiveFromDate <= targetDate) ??
		orderedVersions[orderedVersions.length - 1] ??
		null;

	// Load the version in effect on targetEffectiveFromDate so partial edits preserve unmodified
	// sections & all 7 ArbZG columns without leaking future-scheduled rules into earlier dates.
	const initialVersions = await listPolicyVersionsOrderedInTx(tx, policyId);
	const initialBaseVersion = selectBaseVersionForDate(initialVersions, targetEffectiveFromDate);
	let currentVersion = initialBaseVersion;
	let currentDetails = await loadWorkPolicyVersionDetailsInTx(tx, {
		organizationId,
		policyId,
		policyVersionId: currentVersion?.id,
	});

	let nextScheduleEnabled =
		data.scheduleEnabled ?? currentVersion?.scheduleEnabled ?? existingPolicy.scheduleEnabled;
	let nextRegulationEnabled =
		data.regulationEnabled ?? currentVersion?.regulationEnabled ?? existingPolicy.regulationEnabled;
	let nextPresenceEnabled =
		data.presenceEnabled ?? currentVersion?.presenceEnabled ?? existingPolicy.presenceEnabled;

	// Determine target presence location for lock acquisition BEFORE reading cutover/seal state.
	const incomingPresenceLocationId =
		data.presence === null
			? null
			: data.presence !== undefined
				? data.presence.locationId || null
				: (currentDetails?.presence?.locationId ?? null);

	// A2-5 / A3-3: Validate org ownership for EVERY location that the new version will persist
	// (including inherited disabled presence rules), requiring active status when presence is enabled.
	if (incomingPresenceLocationId) {
		await lockOwnedLocationForShareInTx(
			tx,
			organizationId,
			incomingPresenceLocationId,
			nextPresenceEnabled,
		);
	}

	// A2-17 / M10: If a versioned edit also reactivates the policy, validate presence locations on
	// all projected winning effective & future versions, excluding any existing version that this
	// proposed edit supersedes on `targetEffectiveFromDate` (whose own location was just validated).
	if (data.isActive === true && !existingPolicy.isActive) {
		const excludeIds = new Set<string>();
		for (const v of initialVersions) {
			if (v.effectiveFromDate === targetEffectiveFromDate) {
				excludeIds.add(v.id);
			}
		}
		const currentEffective =
			initialVersions.find((v) => v.effectiveFromDate <= orgTodayDate) ?? null;
		if (
			currentEffective &&
			targetEffectiveFromDate <= orgTodayDate &&
			targetEffectiveFromDate >= currentEffective.effectiveFromDate
		) {
			excludeIds.add(currentEffective.id);
		}
		await validateReactivationPresenceLocationsInTx(tx, {
			organizationId,
			policyId,
			versions: initialVersions,
			orgTodayDate,
			excludeVersionIds: excludeIds,
		});
	}

	// Step 3: Strictly AFTER acquiring work_policy FOR UPDATE + location FOR SHARE, read DB seal/cutover state.
	const sealedCutoverAt = await readSealedCutoverAtInTx(tx);
	const versions = await listPolicyVersionsOrderedInTx(tx, policyId);
	const isPostCutover =
		sealedCutoverAt !== null || versions.some((version) => version.sealedAt !== null);

	if (!isPostCutover) {
		// A1-15: Refuse future-dated version publishing while only in-place unsealed v1 editing is
		// available, so future rules never take effect prematurely during rollout.
		if (requestedEffectiveFromDate && requestedEffectiveFromDate > orgTodayDate) {
			throw new ValidationError({
				message: `Future-dated work policy versions (${requestedEffectiveFromDate}) cannot be scheduled before policy versioning cutover completes.`,
				field: "effectiveFromDate",
				refusal: "versioning_not_sealed",
			});
		}

		// Pre-cutover (pre-0326 or parked-0326): update unsealed v1 in place and dual-write the 3 enablement flags.
		const v1 = await ensurePolicyV1IdempotentlyInTx(tx, {
			organizationId,
			policyId,
			effectiveFromDate: currentVersion?.effectiveFromDate ?? "1970-01-01",
			scheduleEnabled: nextScheduleEnabled,
			regulationEnabled: nextRegulationEnabled,
			presenceEnabled: nextPresenceEnabled,
			createdBy: actorUserId,
		});

		await tx
			.update(workPolicy)
			.set({
				name: data.name ?? existingPolicy.name,
				description: data.description ?? existingPolicy.description,
				isActive: data.isActive ?? existingPolicy.isActive,
				scheduleEnabled: nextScheduleEnabled,
				regulationEnabled: nextRegulationEnabled,
				presenceEnabled: nextPresenceEnabled,
				updatedBy: actorUserId,
				updatedAt: currentTimestamp(),
			})
			.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));

		// Explicit dual-write of the 3 enablement flags to unsealed v1 (essential when parked at 0326 with bridges dropped).
		await tx.execute(sql`
			UPDATE "work_policy_version"
			SET
				"schedule_enabled" = ${nextScheduleEnabled},
				"regulation_enabled" = ${nextRegulationEnabled},
				"presence_enabled" = ${nextPresenceEnabled}
			WHERE "id" = ${v1.id}::uuid
				AND "sealed_at" IS NULL
		`);

		if (data.schedule) {
			if (currentDetails?.schedule) {
				await tx
					.delete(workPolicySchedule)
					.where(eq(workPolicySchedule.id, currentDetails.schedule.id));
			}
			await insertScheduleForVersionInTx(tx, policyId, v1.id, data.schedule);
		}

		if (data.regulation) {
			await upsertRegulationForUnsealedV1InTx(
				tx,
				policyId,
				v1.id,
				data.regulation,
				currentDetails?.regulation ?? null,
			);
		}

		if (data.presence !== undefined) {
			if (currentDetails?.presence) {
				await tx
					.delete(workPolicyPresence)
					.where(eq(workPolicyPresence.id, currentDetails.presence.id));
			}
			if (data.presence) {
				await insertPresenceForVersionInTx(tx, policyId, v1.id, data.presence);
			}
		}

		// A3-11: Pre-seal combined edit setting isActive: false must also retire references.
		if (data.isActive === false && existingPolicy.isActive) {
			await retirePolicyReferencesInTx(tx, {
				organizationId,
				policyId,
				actorUserId,
				orgTodayDate,
				orgTimezone,
				now: dateFromInstant(nowInstant),
			});
		}

		const saved = await loadWorkPolicyVersionDetailsInTx(tx, {
			organizationId,
			policyId,
			policyVersionId: v1.id,
		});
		if (!saved) {
			throw new NotFoundError({
				message: "Failed to fetch updated policy",
				entityType: "work_policy",
			});
		}

		return {
			policy: saved,
			version: {
				...v1,
				scheduleEnabled: nextScheduleEnabled,
				regulationEnabled: nextRegulationEnabled,
				presenceEnabled: nextPresenceEnabled,
			},
			replacesSameDayVersion: null,
			laterScheduledVersions: [],
			metadataOnly: false,
		};
	}

	// Post-cutover: refuse historical effective dates so past absences, balances, and compliance never drift.
	const effectiveFromDate = targetEffectiveFromDate;
	if (effectiveFromDate < orgTodayDate) {
		throw new ValidationError({
			message: `New work policy versions cannot take effect in the past (${effectiveFromDate} is before ${orgTodayDate}).`,
			field: "effectiveFromDate",
			refusal: "effective_date_in_past",
		});
	}

	// Re-resolve base version from the post-lock version list in case another writer committed concurrently.
	const lockedBaseVersion = selectBaseVersionForDate(versions, effectiveFromDate);
	if (lockedBaseVersion && lockedBaseVersion.id !== currentVersion?.id) {
		currentVersion = lockedBaseVersion;
		currentDetails = await loadWorkPolicyVersionDetailsInTx(tx, {
			organizationId,
			policyId,
			policyVersionId: currentVersion.id,
		});
		nextScheduleEnabled =
			data.scheduleEnabled ?? currentVersion.scheduleEnabled ?? existingPolicy.scheduleEnabled;
		nextRegulationEnabled =
			data.regulationEnabled ??
			currentVersion.regulationEnabled ??
			existingPolicy.regulationEnabled;
		nextPresenceEnabled =
			data.presenceEnabled ?? currentVersion.presenceEnabled ?? existingPolicy.presenceEnabled;
	}

	const sameDayExisting =
		versions
			.filter((v) => v.effectiveFromDate === effectiveFromDate)
			.sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;

	const replacesSameDayVersion: SameDayReplacementWarning | null = sameDayExisting
		? {
				replacedVersionId: sameDayExisting.id,
				replacedVersionNumber: sameDayExisting.versionNumber,
				effectiveFromDate,
				message: `Replaces version ${sameDayExisting.versionNumber} effective ${effectiveFromDate} for the entire day.`,
			}
		: null;

	const laterScheduledVersions: LaterScheduledVersionWarning[] = versions
		.filter((v) => v.effectiveFromDate > effectiveFromDate)
		.map((v) => ({
			id: v.id,
			versionNumber: v.versionNumber,
			effectiveFromDate: v.effectiveFromDate,
		}));

	const nextVersionNumber = versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

	const shouldSyncTopLevelFlags = effectiveFromDate <= orgTodayDate;
	const updateNow = input.now ?? currentTimestamp();
	await tx
		.update(workPolicy)
		.set({
			name: data.name ?? existingPolicy.name,
			description: data.description ?? existingPolicy.description,
			isActive: data.isActive ?? existingPolicy.isActive,
			...(shouldSyncTopLevelFlags
				? {
						scheduleEnabled: nextScheduleEnabled,
						regulationEnabled: nextRegulationEnabled,
						presenceEnabled: nextPresenceEnabled,
					}
				: {}),
			updatedBy: actorUserId,
			updatedAt: updateNow,
		})
		.where(and(eq(workPolicy.id, policyId), eq(workPolicy.organizationId, organizationId)));

	if (data.isActive === false && existingPolicy.isActive) {
		await retirePolicyReferencesInTx(tx, {
			organizationId,
			policyId,
			actorUserId,
			orgTodayDate,
			orgTimezone,
			now: updateNow,
		});
	}

	const [createdVersion] = await tx
		.insert(workPolicyVersion)
		.values({
			organizationId,
			policyId,
			versionNumber: nextVersionNumber,
			effectiveFromDate,
			scheduleEnabled: nextScheduleEnabled,
			regulationEnabled: nextRegulationEnabled,
			presenceEnabled: nextPresenceEnabled,
			isLegacyBaseline: false,
			sealedAt: null,
			createdBy: actorUserId,
		})
		.returning();

	// 1 & 2: Schedule + Schedule Days
	if (data.schedule) {
		await insertScheduleForVersionInTx(tx, policyId, createdVersion.id, data.schedule);
	} else if (currentDetails?.schedule) {
		const src = currentDetails.schedule;
		await insertScheduleForVersionInTx(tx, policyId, createdVersion.id, {
			scheduleCycle: src.scheduleCycle,
			scheduleType: src.scheduleType,
			workingDaysPreset: src.workingDaysPreset,
			hoursPerCycle: src.hoursPerCycle ?? undefined,
			homeOfficeDaysPerCycle: src.homeOfficeDaysPerCycle ?? 0,
			days: src.days.map((day) => ({
				dayOfWeek: day.dayOfWeek,
				hoursPerDay: day.hoursPerDay,
				isWorkDay: day.isWorkDay,
				cycleWeek: day.cycleWeek ?? 1,
				latestClockIn: day.latestClockIn,
			})),
		});
	}

	// 3, 4 & 5: Regulation (all 7 ArbZG fields!) + Break Rules + Break Options
	if (data.regulation) {
		await insertRegulationForVersionInTx(
			tx,
			policyId,
			createdVersion.id,
			data.regulation,
			currentDetails?.regulation ?? null,
		);
	} else if (currentDetails?.regulation) {
		const src = currentDetails.regulation;
		await insertRegulationForVersionInTx(
			tx,
			policyId,
			createdVersion.id,
			{
				maxDailyMinutes: src.maxDailyMinutes,
				maxWeeklyMinutes: src.maxWeeklyMinutes,
				maxUninterruptedMinutes: src.maxUninterruptedMinutes,
				minRestPeriodMinutes: src.minRestPeriodMinutes,
				restPeriodEnforcement: src.restPeriodEnforcement,
				overtimeDailyThresholdMinutes: src.overtimeDailyThresholdMinutes,
				overtimeWeeklyThresholdMinutes: src.overtimeWeeklyThresholdMinutes,
				overtimeMonthlyThresholdMinutes: src.overtimeMonthlyThresholdMinutes,
				alertBeforeLimitMinutes: src.alertBeforeLimitMinutes,
				alertThresholdPercent: src.alertThresholdPercent,
				breakRules: src.breakRules.map((rule) => ({
					workingMinutesThreshold: rule.workingMinutesThreshold,
					requiredBreakMinutes: rule.requiredBreakMinutes,
					options: rule.options.map((opt) => ({
						splitCount: opt.splitCount,
						minimumSplitMinutes: opt.minimumSplitMinutes,
						minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
					})),
				})),
			},
			src,
		);
	}

	// 6: Presence — retain saved presence rules independently of `presenceEnabled` so toggling
	// presence off and back on restores saved location/fixed days (Spec #1921 Story 12 / A1-14).
	if (data.presence !== undefined) {
		if (data.presence !== null) {
			await insertPresenceForVersionInTx(tx, policyId, createdVersion.id, data.presence);
		}
	} else if (currentDetails?.presence) {
		const src = currentDetails.presence;
		let fixedDays: string[] | undefined;
		if (src.requiredOnsiteFixedDays) {
			try {
				const parsed = JSON.parse(src.requiredOnsiteFixedDays);
				if (Array.isArray(parsed)) fixedDays = parsed.map(String);
			} catch {
				fixedDays = undefined;
			}
		}
		await insertPresenceForVersionInTx(tx, policyId, createdVersion.id, {
			presenceMode: src.presenceMode,
			requiredOnsiteDays: src.requiredOnsiteDays ?? undefined,
			requiredOnsiteFixedDays: fixedDays,
			locationId: src.locationId,
			evaluationPeriod: src.evaluationPeriod,
			enforcement: src.enforcement,
		});
	}

	const saved = await loadWorkPolicyVersionDetailsInTx(tx, {
		organizationId,
		policyId,
		policyVersionId: createdVersion.id,
	});
	if (!saved) {
		throw new NotFoundError({
			message: "Failed to fetch published work policy version",
			entityType: "work_policy",
		});
	}

	// FINAL STATEMENT OF TRANSACTION: seal the new version.
	const sealedAt = await sealPolicyVersionAsFinalStatementInTx(tx, createdVersion.id);

	return {
		policy: saved,
		version: {
			id: createdVersion.id,
			versionNumber: createdVersion.versionNumber,
			effectiveFromDate: createdVersion.effectiveFromDate,
			scheduleEnabled: createdVersion.scheduleEnabled,
			regulationEnabled: createdVersion.regulationEnabled,
			presenceEnabled: createdVersion.presenceEnabled,
			sealedAt,
		},
		replacesSameDayVersion,
		laterScheduledVersions,
		metadataOnly: false,
	};
}

/**
 * Duplicates a work policy atomically using the DB-state-driven version-aware creation flow.
 */
export async function duplicateVersionedWorkPolicyInTx(
	tx: PolicyTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		policyId: string;
	},
): Promise<{ policy: VersionedWorkPolicyDetails; version: PolicyVersionSummary }> {
	const { organizationId, actorUserId, policyId } = input;
	const source = await loadWorkPolicyVersionDetailsInTx(tx, { organizationId, policyId });
	if (!source) {
		throw new NotFoundError({
			message: "Policy not found",
			entityType: "work_policy",
			entityId: policyId,
		});
	}

	let newName = `${source.name} (Copy)`;
	let copyNumber = 1;
	while (true) {
		const duplicate = await tx.query.workPolicy.findFirst({
			where: and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.name, newName)),
		});
		if (!duplicate) break;
		copyNumber += 1;
		newName = `${source.name} (Copy ${copyNumber})`;
	}

	let fixedDays: string[] | undefined;
	if (source.presence?.requiredOnsiteFixedDays) {
		try {
			const parsed = JSON.parse(source.presence.requiredOnsiteFixedDays);
			if (Array.isArray(parsed)) fixedDays = parsed.map(String);
		} catch {
			fixedDays = undefined;
		}
	}

	return createVersionedWorkPolicyInTx(tx, {
		organizationId,
		actorUserId,
		data: {
			name: newName,
			description: source.description ?? undefined,
			scheduleEnabled: source.scheduleEnabled,
			regulationEnabled: source.regulationEnabled,
			presenceEnabled: source.presenceEnabled,
			schedule: source.schedule
				? {
						scheduleCycle: source.schedule.scheduleCycle,
						scheduleType: source.schedule.scheduleType,
						workingDaysPreset: source.schedule.workingDaysPreset,
						hoursPerCycle: source.schedule.hoursPerCycle ?? undefined,
						homeOfficeDaysPerCycle: source.schedule.homeOfficeDaysPerCycle ?? 0,
						days: source.schedule.days.map((day) => ({
							dayOfWeek: day.dayOfWeek,
							hoursPerDay: day.hoursPerDay,
							isWorkDay: day.isWorkDay,
							cycleWeek: day.cycleWeek ?? 1,
							latestClockIn: day.latestClockIn,
						})),
					}
				: undefined,
			regulation: source.regulation
				? {
						maxDailyMinutes: source.regulation.maxDailyMinutes,
						maxWeeklyMinutes: source.regulation.maxWeeklyMinutes,
						maxUninterruptedMinutes: source.regulation.maxUninterruptedMinutes,
						minRestPeriodMinutes: source.regulation.minRestPeriodMinutes,
						restPeriodEnforcement: source.regulation.restPeriodEnforcement,
						overtimeDailyThresholdMinutes: source.regulation.overtimeDailyThresholdMinutes,
						overtimeWeeklyThresholdMinutes: source.regulation.overtimeWeeklyThresholdMinutes,
						overtimeMonthlyThresholdMinutes: source.regulation.overtimeMonthlyThresholdMinutes,
						alertBeforeLimitMinutes: source.regulation.alertBeforeLimitMinutes,
						alertThresholdPercent: source.regulation.alertThresholdPercent,
						breakRules: source.regulation.breakRules.map((rule) => ({
							workingMinutesThreshold: rule.workingMinutesThreshold,
							requiredBreakMinutes: rule.requiredBreakMinutes,
							options: rule.options.map((opt) => ({
								splitCount: opt.splitCount,
								minimumSplitMinutes: opt.minimumSplitMinutes,
								minimumLongestSplitMinutes: opt.minimumLongestSplitMinutes,
							})),
						})),
					}
				: undefined,
			presence: source.presence
				? {
						presenceMode: source.presence.presenceMode,
						requiredOnsiteDays: source.presence.requiredOnsiteDays ?? undefined,
						requiredOnsiteFixedDays: fixedDays,
						locationId: source.presence.locationId,
						evaluationPeriod: source.presence.evaluationPeriod,
						enforcement: source.presence.enforcement,
					}
				: undefined,
		},
	});
}

export async function createVersionedWorkPolicy(
	db: DatabaseClient,
	input: Parameters<typeof createVersionedWorkPolicyInTx>[1],
) {
	return db.transaction((tx) => createVersionedWorkPolicyInTx(tx, input), {
		isolationLevel: "read committed",
	});
}

export async function updateOrPublishWorkPolicy(
	db: DatabaseClient,
	input: Parameters<typeof updateOrPublishWorkPolicyInTx>[1],
) {
	return db.transaction((tx) => updateOrPublishWorkPolicyInTx(tx, input), {
		isolationLevel: "read committed",
	});
}

export async function duplicateVersionedWorkPolicy(
	db: DatabaseClient,
	input: Parameters<typeof duplicateVersionedWorkPolicyInTx>[1],
) {
	return db.transaction((tx) => duplicateVersionedWorkPolicyInTx(tx, input), {
		isolationLevel: "read committed",
	});
}
