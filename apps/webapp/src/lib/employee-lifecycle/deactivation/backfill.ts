import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, employeeManagers } from "@/db/schema";
import { AuditTrail } from "@/lib/audit-trail";
import type { AuthorizationMutationScope } from "@/lib/authorization/authorization-mutation";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	type FormerEmployeeReportsWithoutManagerNotice,
	notifyFormerEmployeeReportsWithoutManager,
} from "@/lib/notifications/former-employee-reports-without-manager";
import { currentOrganizationAdminUserIds } from "@/lib/notifications/manager-notice-recipients";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { memberIsAccessibleOwnerOrAdmin } from "../authority-sql";
import { onCurrentRoster, rosterCheckInstant } from "../current-roster";
import { checklistPlanSnapshot } from "../reactivation-checklist";
import {
	insertDeactivation,
	recordDeactivationOutcome,
	requestFingerprint,
	writeReceipt,
} from "../receipts";
import { acquireAbsenceCancellationGuards } from "./absences";
import { applyDeactivationConsequences } from "./apply";
import type { DeactivationResult } from "./command";
import { managerLinkAuthorizationEmployeeIds } from "./manager-links";
import { planDeactivationConsequences, readCurrentEmploymentPeriodId } from "./plan";
import type {
	DeactivationAfterCommit,
	DeactivationPlan,
	DeactivationPlanContext,
	DeactivationReader,
	NamedEmployee,
} from "./types";

/**
 * The one-off backfill of #1442 (spec #1437, Organization ADR 0006, decision
 * D15): employees switched off before #1440 never got a deactivation's
 * consequences. For each former employee who is inactive with no departure and
 * no open deactivation record, it
 *
 * 1. recovers when they left: the instant already on the employee, else the
 *    latest surviving `employee.deactivated` audit entry or SCIM `leave` event,
 *    unless a later reactivation, SCIM `join` or employment start undid it.
 *    Audit entries live 365 days; without evidence the date stays not recorded.
 * 2. applies #1440's consequences (`planDeactivationConsequences` /
 *    `applyDeactivationConsequences`) from that instant, else from the run
 *    instant, with `replaceManagers: false` and the reason
 *    `employee_deactivation_backfill`. Reports who would be left with no
 *    current manager keep their link.
 * 3. tells each organization's current admins, once, which reports those are.
 *
 * The dry run (default) plans with the same functions the real run applies,
 * and writes nothing. The real run handles each employee in its own
 * transaction, in the deactivation's lock order, and records an
 * `employee_deactivation` row (reason `employee_deactivation_backfill`), so a
 * second run finds nobody left and changes nothing.
 *
 * Attribution: `audit_log.performed_by` must name a user, so changes are
 * audited under the admin whose surviving audit entry deactivated the
 * employee (as a departure's consequences are under its creator), else under
 * the organization's longest-standing current owner (or admin); the reason
 * marks them as the backfill's.
 */

type Database = typeof appDb;

const logger = createLogger("DeactivationBackfill");

export const BACKFILL_REASON = "employee_deactivation_backfill" as const;
const BACKFILL_COMMAND = "backfill_employee_deactivation";

export type LeftAtSource = "employee" | "audit_log" | "scim";

export interface DeactivationBackfillEmployee {
	employeeId: string;
	name: string;
	/** When they left (ISO); null when no evidence survives (not recorded). */
	leftAt: string | null;
	leftAtSource: LeftAtSource | null;
	/** The instant the consequences apply from: `leftAt`, else the run instant. */
	consequencesFrom: string;
	/** Who the changes are audited under. */
	actorUserId: string;
	/** What the run would change (dry run) or changed (real run). */
	plan: DeactivationPlan;
	/** The `employee_deactivation` row; null in a dry run. */
	deactivationId: string | null;
}

export interface DeactivationBackfillReport {
	organizationId: string;
	mode: "dry_run" | "apply";
	employees: DeactivationBackfillEmployee[];
	/** Reports who keep their link to a former manager because no current manager is left. */
	reportsWithoutManager: NamedEmployee[];
	/** The admins told about them (or who would be told). */
	adminUserIds: string[];
	/** Employees that could not be backfilled; nothing was changed for them. */
	failed: Array<{ employeeId: string; name: string; error: string }>;
	/** After-commit steps (notices, calendar jobs) that failed for applied employees. */
	warnings: Array<{ employeeId: string; message: string }>;
}

export type DeactivationBackfillOptions = {
	organizationIds?: readonly string[];
	/** Change data; without it the run is a dry run. */
	apply?: boolean;
	/** The run instant (consequences of an unrecorded deactivation apply from it). */
	now?: Instant;
	clock?: Clock;
	notify?: (notice: FormerEmployeeReportsWithoutManagerNotice) => Promise<void>;
};

type Candidate = {
	employeeId: string;
	userId: string;
	name: string;
	deactivatedAt: Instant | null;
};

function rows<T>(result: unknown): T[] {
	return typeof result === "object" && result !== null && "rows" in result
		? ((result as { rows: T[] }).rows ?? [])
		: [];
}

/** Text of a timestamptz as ISO UTC with microseconds, parseable by Temporal. */
function isoUtc(column: SQL) {
	return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Former employees the backfill handles: inactive, not offboarded by a
 * departure (effective without a rehire, or pending), and without a
 * deactivation record no reactivation has ended. Organization-scoped.
 */
function candidatePredicate(organizationId: string | null) {
	return sql`e.is_active = false
		${organizationId === null ? sql`` : sql`AND e.organization_id = ${organizationId}`}
		AND NOT employee_employment_ended_without_rehire(e.organization_id, e.id)
		AND NOT EXISTS (
			SELECT 1 FROM employee_departure d
			WHERE d.organization_id = e.organization_id AND d.employee_id = e.id AND d.status = 'pending'
		)
		AND NOT EXISTS (
			SELECT 1 FROM employee_deactivation x
			WHERE x.organization_id = e.organization_id AND x.employee_id = e.id
				AND x.reactivated_at IS NULL
		)`;
}

async function findCandidates(
	reader: Pick<Database, "execute">,
	input: { organizationId: string; employeeId?: string },
): Promise<Candidate[]> {
	const result = await reader.execute(sql`
		SELECT e.id AS employee_id, e.user_id, u.name,
			${isoUtc(sql`e.deactivated_at`)} AS deactivated_at
		FROM employee e
		JOIN "user" u ON u.id = e.user_id
		WHERE ${candidatePredicate(input.organizationId)}
			${input.employeeId ? sql`AND e.id = ${input.employeeId}::uuid` : sql``}
		ORDER BY u.name, e.id
	`);
	return rows<{
		employee_id: string;
		user_id: string;
		name: string | null;
		deactivated_at: string | null;
	}>(result).map((row) => ({
		employeeId: row.employee_id,
		userId: row.user_id,
		name: row.name ?? "",
		deactivatedAt: row.deactivated_at ? parseInstant(row.deactivated_at) : null,
	}));
}

async function organizationsWithCandidates(database: Pick<Database, "execute">): Promise<string[]> {
	const result = await database.execute(sql`
		SELECT DISTINCT e.organization_id FROM employee e
		WHERE ${candidatePredicate(null)}
		ORDER BY e.organization_id
	`);
	return rows<{ organization_id: string }>(result).map((row) => row.organization_id);
}

type LeftAt = {
	at: Instant;
	source: LeftAtSource;
	actorUserId: string | null;
	/** The audit entry the instant was recovered from. */
	auditId: string | null;
};

/**
 * When the employee left: the latest surviving evidence of switching them off
 * (the `employee.deactivated` audit entry, a SCIM `leave` event) that no later
 * evidence of switching them on (an `employee.reactivated` entry, a SCIM
 * `join`, the start of their current employment period) undid.
 */
async function recoverLeftAt(
	reader: Pick<Database, "execute">,
	input: { organizationId: string; employeeId: string },
): Promise<LeftAt | null> {
	const { organizationId, employeeId } = input;
	const result = await reader.execute(sql`
		WITH switched_off AS (
			SELECT (a."timestamp" AT TIME ZONE 'UTC') AS at, 'audit_log' AS source, a.performed_by AS actor,
				a.id::text AS audit_id
			FROM audit_log a
			WHERE a.organization_id = ${organizationId}
				AND a.entity_type = 'employee' AND a.entity_id = ${employeeId}::text
				AND a.action = 'employee.deactivated'
			UNION ALL
			SELECT (l.created_at AT TIME ZONE 'UTC'), 'scim', NULL, NULL
			FROM user_lifecycle_event l
			WHERE l.organization_id = ${organizationId} AND l.employee_id = ${employeeId}::uuid
				AND l.event_type = 'leave'
		), switched_on AS (
			SELECT (a."timestamp" AT TIME ZONE 'UTC') AS at
			FROM audit_log a
			WHERE a.organization_id = ${organizationId}
				AND a.entity_type = 'employee' AND a.entity_id = ${employeeId}::text
				AND a.action = 'employee.reactivated'
			UNION ALL
			SELECT (l.created_at AT TIME ZONE 'UTC')
			FROM user_lifecycle_event l
			WHERE l.organization_id = ${organizationId} AND l.employee_id = ${employeeId}::uuid
				AND l.event_type = 'join'
			UNION ALL
			SELECT p.started_at
			FROM employee_employment_period p
			WHERE p.organization_id = ${organizationId} AND p.employee_id = ${employeeId}::uuid
				AND p.status IN ('open', 'legacy_unknown') AND p.started_at IS NOT NULL
		)
		SELECT ${isoUtc(sql`o.at`)} AS at, o.source, o.actor, o.audit_id
		FROM switched_off o
		WHERE NOT EXISTS (SELECT 1 FROM switched_on n WHERE n.at > o.at)
		ORDER BY o.at DESC, o.source
		LIMIT 1
	`);
	const [row] = rows<{
		at: string;
		source: "audit_log" | "scim";
		actor: string | null;
		audit_id: string | null;
	}>(result);
	return row
		? {
				at: parseInstant(row.at),
				source: row.source,
				actorUserId: row.actor,
				auditId: row.audit_id,
			}
		: null;
}

/** The organization's longest-standing current owner, else admin. */
async function fallbackActorUserId(
	reader: Pick<Database, "execute">,
	organizationId: string,
	at: Instant,
): Promise<string | null> {
	// Roles are comma-separated with optional spaces, as `memberIsAccessibleOwnerOrAdmin` reads them.
	const separator = String.raw`\s*,\s*`;
	const result = await reader.execute(sql`
		SELECT m.user_id
		FROM member m
		WHERE m.organization_id = ${organizationId}
			AND ${memberIsAccessibleOwnerOrAdmin(rosterCheckInstant(at))}
		ORDER BY ('owner' = ANY(regexp_split_to_array(COALESCE(m.role, ''), ${separator}))) DESC,
			m.created_at, m.id
		LIMIT 1
	`);
	return rows<{ user_id: string }>(result)[0]?.user_id ?? null;
}

type Prepared = {
	candidate: Candidate;
	leftAt: LeftAt | null;
	actorUserId: string;
	context: DeactivationPlanContext;
	plan: DeactivationPlan;
};

/** Everything the dry run reports and the real run applies, for one employee. */
async function prepare(
	reader: DeactivationReader & Pick<Database, "execute">,
	input: { organizationId: string; candidate: Candidate; runAt: Instant },
): Promise<Prepared | { error: string }> {
	const { organizationId, candidate, runAt } = input;
	const scope = { organizationId, employeeId: candidate.employeeId };
	const recovered = candidate.deactivatedAt
		? { at: candidate.deactivatedAt, source: "employee" as const, actorUserId: null, auditId: null }
		: await recoverLeftAt(reader, scope);
	const actorUserId =
		recovered?.actorUserId ?? (await fallbackActorUserId(reader, organizationId, runAt));
	if (!actorUserId) {
		return { error: "The organization has no current owner or admin to attribute the changes to" };
	}
	const context: DeactivationPlanContext = {
		...scope,
		at: recovered?.at ?? runAt,
		organizationTimeZone: await loadOrganizationTimezone(reader, organizationId),
		employmentPeriodId: await readCurrentEmploymentPeriodId(reader, scope),
		replacementManagers: {},
		replaceManagers: false,
	};
	const plan = await planDeactivationConsequences(reader, context);
	return { candidate, leftAt: recovered, actorUserId, context, plan };
}

function reportEntry(
	prepared: Prepared,
	deactivationId: string | null,
): DeactivationBackfillEmployee {
	return {
		employeeId: prepared.candidate.employeeId,
		name: prepared.candidate.name,
		leftAt: prepared.leftAt ? prepared.leftAt.at.toString() : null,
		leftAtSource: prepared.leftAt?.source ?? null,
		consequencesFrom: prepared.context.at.toString(),
		actorUserId: prepared.actorUserId,
		plan: prepared.plan,
		deactivationId,
	};
}

type Applied =
	| {
			kind: "applied";
			entry: DeactivationBackfillEmployee;
			audit: AuditTrail;
			afterCommit: DeactivationAfterCommit[];
	  }
	| { kind: "skipped" }
	| { kind: "failed"; error: string };

/**
 * Backfills one employee in its own transaction, in the deactivation's lock
 * order (D12): absence write gates, the organization configuration guard, the
 * user guards of the person, their reports and their managers, then the
 * organization row. Re-checks that the employee still needs it.
 */
async function applyOne(
	database: Database,
	input: { organizationId: string; candidate: Candidate; runAt: Instant; clock?: Clock },
): Promise<Applied> {
	const { organizationId, candidate } = input;
	const scope: AuthorizationMutationScope = {
		organizationId,
		organizationWide: true,
		employeeIds: [candidate.employeeId],
		route: async (tx) => ({
			employeeIds: await managerLinkAuthorizationEmployeeIds(tx, {
				organizationId,
				employeeId: candidate.employeeId,
			}),
		}),
		beforeProtection: (tx) => acquireAbsenceCancellationGuards(tx, organizationId),
	};
	return withAuthorizationMutation(
		scope,
		async (tx): Promise<Applied> => {
			const [locked] = await tx
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.id, organizationId))
				.for("update");
			if (!locked) return { kind: "skipped" };
			const [current] = await findCandidates(tx, {
				organizationId,
				employeeId: candidate.employeeId,
			});
			if (!current) return { kind: "skipped" };
			const prepared = await prepare(tx, {
				organizationId,
				candidate: current,
				runAt: input.runAt,
			});
			if ("error" in prepared) return { kind: "failed", error: prepared.error };
			const { context, plan, actorUserId, leftAt } = prepared;

			if (leftAt && leftAt.source !== "employee") {
				// Only the instant: the trigger on is_active stays untouched. The candidate was
				// re-read under the person's authorization guard and the organization row lock.
				await tx
					.update(employee)
					.set({ deactivatedAt: dateFromInstant(leftAt.at) })
					.where(
						and(
							eq(employee.organizationId, organizationId),
							eq(employee.id, current.employeeId),
							isNull(employee.deactivatedAt),
						),
					);
			}

			const requestId = randomUUID();
			const fingerprint = requestFingerprint(
				{ userId: actorUserId, organizationId },
				BACKFILL_COMMAND,
				{ employeeId: current.employeeId },
			);
			const { id: deactivationId } = await insertDeactivation(tx, {
				organizationId,
				employeeId: current.employeeId,
				employmentPeriodId: context.employmentPeriodId,
				// For an unrecorded date: the run instant the consequences apply from.
				deactivatedAt: context.at,
				createdBy: actorUserId,
				reason: BACKFILL_REASON,
				requestId,
				requestFingerprint: fingerprint,
				replacementManagers: {},
			});
			const audit = new AuditTrail();
			const { applied, afterCommit } = await applyDeactivationConsequences(
				tx,
				{ ...context, actorUserId, deactivationId, reason: BACKFILL_REASON, audit },
				plan,
				{ clock: input.clock },
			);
			const reportsWithoutManager = plan.managerLinks.reportsNeedingReplacement.map((report) => ({
				employeeId: report.employeeId,
				name: report.name,
			}));
			const result: DeactivationResult & { backfill: Record<string, unknown> } = {
				deactivationId,
				employeeId: current.employeeId,
				employeeUserId: current.userId,
				deactivatedAt: context.at.toString(),
				plannerNotice: null,
				releasedDeputies: null,
				cancelledAbsenceIds: applied.absences.cancelledAbsenceIds,
				backfill: {
					leftAt: leftAt ? leftAt.at.toString() : null,
					leftAtSource: leftAt?.source ?? null,
					reportsWithoutManager,
				},
			};
			await recordDeactivationOutcome(tx, {
				organizationId,
				deactivationId,
				applied,
				result,
				// The names a reactivated employee's checklist shows (#1441).
				plan: checklistPlanSnapshot(plan),
			});
			if (leftAt && context.employmentPeriodId) {
				// The employment history event (#1441), only for a recovered instant.
				await writeReceipt(tx, {
					actor: { userId: actorUserId, organizationId },
					employeeId: current.employeeId,
					employmentPeriodId: context.employmentPeriodId,
					departureId: null,
					revision: null,
					requestId,
					fingerprint,
					kind: "employee_deactivated",
					occurredAt: dateFromInstant(leftAt.at),
					result,
					// The history shows this event once, not again as its source audit entry.
					metadata: { deactivationId, reason: BACKFILL_REASON, sourceAuditId: leftAt.auditId },
				});
			}
			return { kind: "applied", entry: reportEntry(prepared, deactivationId), audit, afterCommit };
		},
		database,
	);
}

/**
 * Of the given reports, those on the current roster whose every manager link
 * points to a former employee (or who have none left). Organization-scoped.
 */
async function reportsStillWithoutCurrentManager(
	reader: Pick<Database, "select" | "selectDistinct">,
	input: { organizationId: string; reports: readonly NamedEmployee[]; at: Instant },
): Promise<NamedEmployee[]> {
	if (input.reports.length === 0) return [];
	const ids = [...new Set(input.reports.map((report) => report.employeeId))];
	const current = await reader
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, ids),
				onCurrentRoster(input.organizationId, employee, input.at),
			),
		);
	const manager = alias(employee, "manager_employee");
	const managed = await reader
		.selectDistinct({ id: employeeManagers.employeeId })
		.from(employeeManagers)
		.innerJoin(
			manager,
			and(
				eq(manager.id, employeeManagers.managerId),
				eq(manager.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				inArray(employeeManagers.employeeId, ids),
				onCurrentRoster(input.organizationId, manager, input.at),
			),
		);
	const currentIds = new Set(current.map((row) => row.id));
	const managedIds = new Set(managed.map((row) => row.id));
	const seen = new Set<string>();
	return input.reports
		.filter((report) => {
			if (seen.has(report.employeeId)) return false;
			seen.add(report.employeeId);
			return currentIds.has(report.employeeId) && !managedIds.has(report.employeeId);
		})
		.toSorted(
			(left, right) =>
				left.name.localeCompare(right.name) || left.employeeId.localeCompare(right.employeeId),
		);
}

async function runAfterCommit(
	steps: readonly DeactivationAfterCommit[],
	employeeId: string,
	warnings: DeactivationBackfillReport["warnings"],
) {
	for (const step of steps) {
		try {
			await step();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error, employeeId }, "Deactivation backfill after-commit step failed");
			warnings.push({ employeeId, message });
		}
	}
}

async function backfillOrganization(
	database: Database,
	organizationId: string,
	options: Required<Pick<DeactivationBackfillOptions, "notify">> & {
		apply: boolean;
		runAt: Instant;
		clock?: Clock;
	},
): Promise<DeactivationBackfillReport> {
	const report: DeactivationBackfillReport = {
		organizationId,
		mode: options.apply ? "apply" : "dry_run",
		employees: [],
		reportsWithoutManager: [],
		adminUserIds: [],
		failed: [],
		warnings: [],
	};
	const candidates = await findCandidates(database, { organizationId });
	for (const candidate of candidates) {
		const fail = (error: unknown) =>
			report.failed.push({
				employeeId: candidate.employeeId,
				name: candidate.name,
				error: error instanceof Error ? error.message : String(error),
			});
		try {
			if (!options.apply) {
				const prepared = await prepare(database, {
					organizationId,
					candidate,
					runAt: options.runAt,
				});
				if ("error" in prepared) fail(prepared.error);
				else report.employees.push(reportEntry(prepared, null));
				continue;
			}
			const outcome = await applyOne(database, {
				organizationId,
				candidate,
				runAt: options.runAt,
				clock: options.clock,
			});
			if (outcome.kind === "failed") fail(outcome.error);
			if (outcome.kind !== "applied") continue;
			report.employees.push(outcome.entry);
			outcome.audit.forwardCommitted();
			await runAfterCommit(outcome.afterCommit, candidate.employeeId, report.warnings);
		} catch (error) {
			logger.error({ error, organizationId, employeeId: candidate.employeeId }, "Backfill failed");
			fail(error);
		}
	}

	report.reportsWithoutManager = await reportsStillWithoutCurrentManager(database, {
		organizationId,
		reports: report.employees.flatMap((entry) =>
			entry.plan.managerLinks.reportsNeedingReplacement.map((item) => ({
				employeeId: item.employeeId,
				name: item.name,
			})),
		),
		at: options.runAt,
	});
	if (report.reportsWithoutManager.length > 0) {
		report.adminUserIds = await currentOrganizationAdminUserIds(database, {
			organizationId,
			now: options.runAt,
		});
		if (options.apply && report.adminUserIds.length > 0) {
			await options.notify({
				organizationId,
				reports: report.reportsWithoutManager,
				recipientUserIds: report.adminUserIds,
			});
		}
	}
	return report;
}

/**
 * Runs the backfill for the named organizations, or for every organization
 * with an employee left to backfill, one organization at a time. A dry run
 * unless `apply` is set.
 */
export async function backfillDeactivatedEmployees(
	database: Database,
	options: DeactivationBackfillOptions = {},
): Promise<DeactivationBackfillReport[]> {
	const clock = options.clock ?? systemClock;
	const runAt = options.now ?? clock.nowInstant();
	const organizationIds = options.organizationIds ?? (await organizationsWithCandidates(database));
	const reports: DeactivationBackfillReport[] = [];
	for (const organizationId of organizationIds) {
		reports.push(
			await backfillOrganization(database, organizationId, {
				apply: options.apply === true,
				runAt,
				clock: options.clock,
				notify: options.notify ?? notifyFormerEmployeeReportsWithoutManager,
			}),
		);
	}
	return reports;
}
