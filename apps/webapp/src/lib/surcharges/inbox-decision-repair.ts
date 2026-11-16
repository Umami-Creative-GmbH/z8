import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { surchargeCalculation, timeEntry, workPeriod } from "@/db/schema";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ReconcileSurchargeWorkPeriodsInput,
	SurchargeService,
	SurchargeServiceLive,
	type SurchargeWorkPeriodEvidence,
	snapshotSurchargeCalculationRow,
} from "@/lib/effect/services/surcharge.service";
import {
	type PolicyClockOutSurchargeSnapshot,
	parsePolicyClockOutSurchargeSnapshot,
} from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";

/**
 * Repair of the surcharges the approval inbox skipped (#1690, after #1674).
 *
 * From 2026-07-24 (dac170f82) until #1674, deciding a manual time submission
 * or a policy clock-out at its terminal stage from the approval inbox skipped
 * the decision's after-commit surcharge maintenance. Stored data does not say
 * which entry point decided, so this repair revisits every terminal decision
 * of those kinds in the window, in organizations with surcharges enabled, and
 * reconciles only the periods whose surcharge rows differ from what that
 * decision's maintenance writes:
 *
 * - approved: the period, and the generated half of a split policy clock-out,
 *   gets the rows its captured surcharge snapshot credits;
 * - rejected: the period's surcharge rows are removed.
 *
 * The expected rows are a pure function of the decision's stored snapshot and
 * the period's clock entries, so a period already maintained (decided
 * elsewhere, or repaired before) compares equal and is left untouched: a second
 * run changes nothing. Reconciliation goes through
 * `SurchargeService.reconcileWorkPeriods`, one period at a time.
 */

/** Maintenance was first skipped on 2026-07-24 (dac170f82, 04:13 +02:00); the day is included whole. */
export const INBOX_SKIPPED_SURCHARGES_SINCE = parseInstant("2026-07-24T00:00:00Z");

const ORDINARY_KINDS = ["manual_time_submission", "policy_clock_out"] as const;
type OrdinaryKind = (typeof ORDINARY_KINDS)[number];

export type InboxDecisionSurchargeRepairSkip =
	/** An approval without a captured snapshot (a historical request): its maintenance computes nothing. */
	| "no_surcharge_snapshot"
	/** A historical policy clock-out rejection: its maintenance leaves the surcharges as they are. */
	| "historical_policy_clock_out"
	/** The period's times no longer match the decided work; a later change owns its surcharges. */
	| "changed_since_decision";

export interface InboxDecisionSurchargeRepairReport {
	organizationId: string;
	/** Terminal manual time submission and policy clock-out decisions in the window. */
	decided: number;
	/** Approvals whose surcharges differed (repaired, or would be in a dry run). */
	approvedRepairs: number;
	/** Rejections that still held surcharges (removed, or would be in a dry run). */
	rejectedRepairs: number;
	/** Decisions whose surcharges already match their maintenance. */
	unchanged: number;
	skipped: Array<{ workPeriodId: string; reason: InboxDecisionSurchargeRepairSkip }>;
	failed: Array<{ workPeriodId: string; error: string }>;
}

export interface InboxDecisionSurchargeRepairOptions {
	organizationIds?: readonly string[];
	/** Without it nothing is written: the report says what a real run would change. */
	apply: boolean;
	reconcile?: (input: ReconcileSurchargeWorkPeriodsInput) => Promise<void>;
}

type Database = typeof db;

interface DecidedPeriod {
	id: string;
	employee_id: string;
	approval_status: "approved" | "rejected";
	end_time: Date | null;
	original_end_time: Date | null;
	auto_adjusted_at: Date | null;
	kind: OrdinaryKind;
	surcharge_snapshot: unknown;
}

function reconcileThroughService(input: ReconcileSurchargeWorkPeriodsInput): Promise<void> {
	// Lazy: the shared runtime loads the app layer, which a dry run never needs.
	return import("@/lib/effect/runtime").then(({ runtime }) =>
		runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* SurchargeService;
				yield* service.reconcileWorkPeriods(input);
			}).pipe(Effect.provide(SurchargeServiceLive)),
		),
	);
}

/**
 * Every work period of the organization whose latest record decision is a
 * terminal manual time submission or policy clock-out decision in the window,
 * still in that decision's state, with the decision's kind and snapshot.
 */
async function loadDecidedPeriods(
	database: Database,
	organizationId: string,
): Promise<DecidedPeriod[]> {
	const since = dateFromInstant(INBOX_SKIPPED_SURCHARGES_SINCE);
	const kinds = sql.join(
		ORDINARY_KINDS.map((kind) => sql`${kind}`),
		sql`, `,
	);
	const result = await database.execute<
		Pick<DecidedPeriod, "id" | "employee_id" | "approval_status" | "kind" | "surcharge_snapshot">
	>(sql`
		with latest_decision as (
			select distinct on (decision.record_id)
				decision.record_id, decision.action::text as action, decision.created_at
			from time_record_approval_decision decision
			where decision.organization_id = ${organizationId}
				and decision.action::text in ('approved', 'rejected')
			order by decision.record_id, decision.created_at desc, decision.id desc
		)
		select period.id, period.employee_id, period.approval_status::text as approval_status,
			coalesce(workflow.kind, request.kind) as kind,
			case when workflow.kind is not null then workflow.snapshot else request.snapshot end
				as surcharge_snapshot
		from work_period period
		join latest_decision on latest_decision.record_id = period.canonical_record_id
		left join lateral (
			select candidate.workflow_type::text as kind,
				candidate.context_snapshot -> 'surchargeSnapshot' as snapshot
			from approval_workflow candidate
			where candidate.organization_id = period.organization_id
				and candidate.source_type = 'time_entry'
				and candidate.source_id = period.id
				and candidate.workflow_type::text in (${kinds})
				and candidate.status::text = period.approval_status::text
			order by candidate.completed_at desc nulls last, candidate.created_at desc, candidate.id desc
			limit 1
		) workflow on true
		left join lateral (
			select candidate.metadata -> 'timeRequest' ->> 'kind' as kind,
				candidate.metadata -> 'surchargeSnapshot' as snapshot
			from approval_request candidate
			where candidate.organization_id = period.organization_id
				and candidate.entity_type = 'time_entry'
				and candidate.entity_id = period.id
				and candidate.status::text = period.approval_status::text
				and candidate.metadata -> 'timeRequest' ->> 'kind' in (${kinds})
			order by candidate.approved_at desc nulls last, candidate.updated_at desc, candidate.id desc
			limit 1
		) request on true
		where period.organization_id = ${organizationId}
			and period.deleted_at is null
			and period.approval_status::text in ('approved', 'rejected')
			and latest_decision.action = period.approval_status::text
			and latest_decision.created_at >= ${since}
			and coalesce(workflow.kind, request.kind) is not null
		order by period.id
	`);
	if (result.rows.length === 0) return [];
	// The period's instants through the typed columns, as Dates in UTC.
	const times = await database
		.select({
			id: workPeriod.id,
			endTime: workPeriod.endTime,
			originalEndTime: workPeriod.originalEndTime,
			autoAdjustedAt: workPeriod.autoAdjustedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(
					workPeriod.id,
					result.rows.map(({ id }) => id),
				),
			),
		);
	return result.rows.map((row) => {
		const period = times.find(({ id }) => id === row.id);
		return {
			...row,
			end_time: period?.endTime ?? null,
			original_end_time: period?.originalEndTime ?? null,
			auto_adjusted_at: period?.autoAdjustedAt ?? null,
		};
	});
}

async function loadPeriodEvidence(
	database: Database,
	organizationId: string,
	employeeId: string,
	periodIds: readonly string[],
): Promise<SurchargeWorkPeriodEvidence[]> {
	const periods = await database
		.select({
			id: workPeriod.id,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				inArray(workPeriod.id, [...periodIds]),
			),
		)
		.orderBy(asc(workPeriod.startTime));
	const entryIds = periods.flatMap((period) =>
		period.clockOutId ? [period.clockInId, period.clockOutId] : [period.clockInId],
	);
	const entries =
		entryIds.length === 0
			? []
			: await database
					.select({
						id: timeEntry.id,
						timestamp: timeEntry.timestamp,
						timezone: timeEntry.timezone,
						utcOffsetMinutes: timeEntry.utcOffsetMinutes,
					})
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, organizationId),
							eq(timeEntry.employeeId, employeeId),
							inArray(timeEntry.id, entryIds),
						),
					);
	const entry = (id: string | null) => entries.find((candidate) => candidate.id === id) ?? null;
	return periods.map((period) => ({
		id: period.id,
		startTime: period.startTime,
		endTime: period.endTime,
		clockIn: entry(period.clockInId),
		clockOut: entry(period.clockOutId),
	}));
}

/**
 * The periods an approval's maintenance reconciles: the decided period, and
 * for a policy clock-out divided by its owed break the generated half (same
 * division instant, ending where the decided work ended). Null when the
 * period's times no longer match the decided work.
 */
async function approvedTargets(
	database: Database,
	organizationId: string,
	period: DecidedPeriod,
	evaluatedAt: Date,
): Promise<string[] | null> {
	if (period.end_time?.getTime() === evaluatedAt.getTime()) return [period.id];
	if (
		period.kind !== "policy_clock_out" ||
		!period.auto_adjusted_at ||
		period.original_end_time?.getTime() !== evaluatedAt.getTime() ||
		!period.end_time
	) {
		return null;
	}
	const generated = await database
		.select({ id: workPeriod.id, startTime: workPeriod.startTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, period.employee_id),
				eq(workPeriod.autoAdjustedAt, period.auto_adjusted_at),
				eq(workPeriod.endTime, evaluatedAt),
				eq(workPeriod.approvalStatus, "approved"),
				isNull(workPeriod.deletedAt),
			),
		);
	const halves = generated.filter(
		(half) =>
			half.id !== period.id && half.startTime.getTime() >= (period.end_time as Date).getTime(),
	);
	return halves.length === 1 && halves[0] ? [period.id, halves[0].id] : null;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** A surcharge row by what it credits, without its identity and calculation instant. */
function creditedKey(row: {
	workPeriodId: string;
	employeeId: string;
	surchargeRuleId?: string | null;
	surchargeModelId?: string | null;
	baseMinutes: number;
	qualifyingMinutes: number;
	surchargeMinutes: number;
	appliedPercentage: string;
	calculationDetails?: unknown;
}): string {
	let details: unknown = row.calculationDetails ?? null;
	if (typeof details === "string") {
		try {
			details = JSON.parse(details);
		} catch {
			// An unreadable breakdown never matches a computed one.
		}
	}
	if (details && typeof details === "object" && !Array.isArray(details)) {
		const { calculatedAt: _calculatedAt, ...credited } = details as Record<string, unknown>;
		details = credited;
	}
	return stableJson({
		workPeriodId: row.workPeriodId,
		employeeId: row.employeeId,
		surchargeRuleId: row.surchargeRuleId ?? null,
		surchargeModelId: row.surchargeModelId ?? null,
		baseMinutes: row.baseMinutes,
		qualifyingMinutes: row.qualifyingMinutes,
		surchargeMinutes: row.surchargeMinutes,
		appliedPercentage: Number(row.appliedPercentage),
		details,
	});
}

async function storedCreditedKeys(
	database: Database,
	organizationId: string,
	periodIds: readonly string[],
): Promise<string[]> {
	const rows = await database
		.select()
		.from(surchargeCalculation)
		.where(
			and(
				eq(surchargeCalculation.organizationId, organizationId),
				inArray(surchargeCalculation.workPeriodId, [...periodIds]),
			),
		);
	return rows.map(creditedKey).sort();
}

function parseSnapshot(value: unknown): PolicyClockOutSurchargeSnapshot | null {
	if (value === null || value === undefined) return null;
	const evaluatedAt = (value as { evaluatedAt?: unknown }).evaluatedAt;
	if (typeof evaluatedAt !== "string") throw new Error("surcharge snapshot without evaluatedAt");
	return parsePolicyClockOutSurchargeSnapshot(value, evaluatedAt);
}

async function repairOrganization(
	database: Database,
	organizationId: string,
	options: InboxDecisionSurchargeRepairOptions,
): Promise<InboxDecisionSurchargeRepairReport> {
	const reconcile = options.reconcile ?? reconcileThroughService;
	const report: InboxDecisionSurchargeRepairReport = {
		organizationId,
		decided: 0,
		approvedRepairs: 0,
		rejectedRepairs: 0,
		unchanged: 0,
		skipped: [],
		failed: [],
	};
	for (const period of await loadDecidedPeriods(database, organizationId)) {
		report.decided += 1;
		try {
			const snapshot = parseSnapshot(period.surcharge_snapshot);
			if (period.approval_status === "rejected") {
				if ((await storedCreditedKeys(database, organizationId, [period.id])).length === 0) {
					report.unchanged += 1;
					continue;
				}
				// The finalizer runs no maintenance for an unmarked historical policy clock-out.
				if (!snapshot && period.kind === "policy_clock_out") {
					report.skipped.push({ workPeriodId: period.id, reason: "historical_policy_clock_out" });
					continue;
				}
				report.rejectedRepairs += 1;
				if (options.apply) {
					await reconcile({
						organizationId,
						employeeId: period.employee_id,
						surchargePeriodIds: [],
						staleSurchargePeriodIds: [period.id],
						surchargeSnapshot: null,
					});
				}
				continue;
			}
			if (!snapshot) {
				report.skipped.push({ workPeriodId: period.id, reason: "no_surcharge_snapshot" });
				continue;
			}
			const targets = await approvedTargets(
				database,
				organizationId,
				period,
				dateFromInstant(parseInstant(snapshot.evaluatedAt)),
			);
			if (!targets) {
				report.skipped.push({ workPeriodId: period.id, reason: "changed_since_decision" });
				continue;
			}
			// The calculation instant is not part of the comparison.
			const calculatedAt = new Date(0);
			const expected = (
				await loadPeriodEvidence(database, organizationId, period.employee_id, targets)
			)
				.flatMap((evidence) => {
					const row = snapshotSurchargeCalculationRow({
						organizationId,
						employeeId: period.employee_id,
						period: evidence,
						snapshot,
						calculatedAt,
					});
					return row ? [creditedKey(row)] : [];
				})
				.sort();
			const stored = await storedCreditedKeys(database, organizationId, targets);
			if (stableJson(stored) === stableJson(expected)) {
				report.unchanged += 1;
				continue;
			}
			report.approvedRepairs += 1;
			if (options.apply) {
				await reconcile({
					organizationId,
					employeeId: period.employee_id,
					surchargePeriodIds: targets,
					staleSurchargePeriodIds: [],
					surchargeSnapshot: snapshot,
				});
			}
		} catch (error) {
			report.failed.push({
				workPeriodId: period.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return report;
}

/**
 * Runs the repair for every organization with surcharges enabled (or only
 * those named), one organization and one period at a time.
 */
export async function repairInboxDecisionSurcharges(
	database: Database,
	options: InboxDecisionSurchargeRepairOptions,
): Promise<InboxDecisionSurchargeRepairReport[]> {
	const organizations = await database
		.select({ id: organization.id })
		.from(organization)
		.where(
			and(
				eq(organization.surchargesEnabled, true),
				options.organizationIds
					? inArray(organization.id, [...options.organizationIds])
					: undefined,
			),
		)
		.orderBy(asc(organization.id));
	const reports: InboxDecisionSurchargeRepairReport[] = [];
	for (const { id } of organizations) {
		reports.push(await repairOrganization(database, id, options));
	}
	return reports;
}
