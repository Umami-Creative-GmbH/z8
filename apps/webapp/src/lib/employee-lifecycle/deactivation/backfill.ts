import "server-only";

import { type SQL, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type Clock,
	compareInstants,
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
import { memberIsAccessibleOwnerOrAdmin } from "../authority-sql";
import { rosterCheckInstant } from "../current-roster";
import { formerEmployeeWithoutDeactivation } from "./former-employee";
import {
	planNonInteractiveDeactivation,
	reportsStillWithoutCurrentManager,
	runNonInteractiveDeactivation,
} from "./non-interactive";
import type { DeactivationPlan, NamedEmployee } from "./types";

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
 * 2. deactivates them through the non-interactive deactivation (#1627,
 *    `./non-interactive`): Employment ending (equipment responsibility, grants,
 *    document requests, deputy assignments, ...) and the roster areas, from the
 *    run instant (or that instant, were it later), with `replaceManagers: false`
 *    and the reason `employee_deactivation_backfill`: shifts and absences change
 *    only from now on, so nothing in the past is reopened or cancelled (user
 *    decision 2026-10-24). The recovered instant is kept only as when they left
 *    (the left-on date, "Former since"). Reports who would be left with no
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

export type LeftAtSource = "employee" | "audit_log" | "scim";

export interface DeactivationBackfillEmployee {
	employeeId: string;
	name: string;
	/** When they left (ISO); null when no evidence survives (not recorded). */
	leftAt: string | null;
	leftAtSource: LeftAtSource | null;
	/** The instant the consequences apply from: the run instant (or `leftAt`, were it later). */
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
	name: string;
	deactivatedAt: Instant | null;
};

/** Text of a timestamptz as ISO UTC with microseconds, parseable by Temporal. */
function isoUtc(column: SQL) {
	return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Former employees the backfill handles: inactive, not offboarded by a
 * departure, and without a deactivation record no reactivation has ended (the
 * runner re-checks the same under its locks). Organization-scoped.
 */
async function findCandidates(
	reader: Pick<Database, "execute">,
	input: { organizationId: string },
): Promise<Candidate[]> {
	const result = await reader.execute<{
		employee_id: string;
		name: string | null;
		deactivated_at: string | null;
	}>(sql`
		SELECT e.id AS employee_id, u.name,
			${isoUtc(sql`e.deactivated_at`)} AS deactivated_at
		FROM employee e
		JOIN "user" u ON u.id = e.user_id
		WHERE ${formerEmployeeWithoutDeactivation(input.organizationId)}
		ORDER BY u.name, e.id
	`);
	return result.rows.map((row) => ({
		employeeId: row.employee_id,
		name: row.name ?? "",
		deactivatedAt: row.deactivated_at ? parseInstant(row.deactivated_at) : null,
	}));
}

async function organizationsWithCandidates(database: Pick<Database, "execute">): Promise<string[]> {
	const result = await database.execute<{ organization_id: string }>(sql`
		SELECT DISTINCT e.organization_id FROM employee e
		WHERE ${formerEmployeeWithoutDeactivation(null)}
		ORDER BY e.organization_id
	`);
	return result.rows.map((row) => row.organization_id);
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
	const result = await reader.execute<{
		at: string;
		source: "audit_log" | "scim";
		actor: string | null;
		audit_id: string | null;
	}>(sql`
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
	const [row] = result.rows;
	return row
		? {
				at: parseInstant(row.at),
				source: row.source,
				actorUserId: row.actor,
				auditId: row.audit_id,
			}
		: null;
}

/**
 * When they left, for an instant already on the employee (deactivated through
 * the action after #1439, before #1440). That action wrote its
 * `employee.deactivated` audit entry, without metadata, just after the commit;
 * where it survives it names the admin, and the history shows the backfill's
 * event in its place instead of both.
 */
async function leftAtOnEmployee(
	reader: Pick<Database, "execute">,
	input: { organizationId: string; employeeId: string; at: Instant },
): Promise<LeftAt> {
	const at = sql`${dateFromInstant(input.at)}::timestamptz`;
	const result = await reader.execute<{ audit_id: string; actor: string }>(sql`
		SELECT a.id::text AS audit_id, a.performed_by AS actor
		FROM audit_log a
		WHERE a.organization_id = ${input.organizationId}
			AND a.entity_type = 'employee' AND a.entity_id = ${input.employeeId}::text
			AND a.action = 'employee.deactivated'
			AND (a."timestamp" AT TIME ZONE 'UTC') BETWEEN ${at} - interval '1 minute'
				AND ${at} + interval '5 minutes'
		ORDER BY abs(extract(epoch FROM (a."timestamp" AT TIME ZONE 'UTC') - ${at})), a.id
		LIMIT 1
	`);
	const [match] = result.rows;
	return {
		at: input.at,
		source: "employee",
		actorUserId: match?.actor ?? null,
		auditId: match?.audit_id ?? null,
	};
}

/** The organization's longest-standing current owner, else admin. */
async function fallbackActorUserId(
	reader: Pick<Database, "execute">,
	organizationId: string,
	at: Instant,
): Promise<string | null> {
	// Roles are comma-separated with optional spaces, as `memberIsAccessibleOwnerOrAdmin` reads them.
	const separator = String.raw`\s*,\s*`;
	const result = await reader.execute<{ user_id: string }>(sql`
		SELECT m.user_id
		FROM member m
		WHERE m.organization_id = ${organizationId}
			AND ${memberIsAccessibleOwnerOrAdmin(rosterCheckInstant(at))}
		ORDER BY ('owner' = ANY(regexp_split_to_array(COALESCE(m.role, ''), ${separator}))) DESC,
			m.created_at, m.id
		LIMIT 1
	`);
	return result.rows[0]?.user_id ?? null;
}

/** Who the backfill attributes an employee's deactivation to, and from when it applies. */
type Attribution = {
	candidate: Candidate;
	leftAt: LeftAt | null;
	actorUserId: string;
	/** The run instant, or the recovered instant were it later. */
	consequencesFrom: Instant;
};

async function attribute(
	reader: Pick<Database, "execute">,
	input: { organizationId: string; candidate: Candidate; runAt: Instant },
): Promise<Attribution | { error: string }> {
	const { organizationId, candidate, runAt } = input;
	const scope = { organizationId, employeeId: candidate.employeeId };
	const recovered = candidate.deactivatedAt
		? await leftAtOnEmployee(reader, { ...scope, at: candidate.deactivatedAt })
		: await recoverLeftAt(reader, scope);
	const actorUserId =
		recovered?.actorUserId ?? (await fallbackActorUserId(reader, organizationId, runAt));
	if (!actorUserId) {
		return { error: "The organization has no current owner or admin to attribute the changes to" };
	}
	return {
		candidate,
		leftAt: recovered,
		actorUserId,
		// Shifts and absences change only from now on; the recovered instant is the left-on date.
		consequencesFrom: recovered && compareInstants(recovered.at, runAt) > 0 ? recovered.at : runAt,
	};
}

function reportEntry(
	attribution: Attribution,
	plan: DeactivationPlan,
	deactivationId: string | null,
): DeactivationBackfillEmployee {
	return {
		employeeId: attribution.candidate.employeeId,
		name: attribution.candidate.name,
		leftAt: attribution.leftAt ? attribution.leftAt.at.toString() : null,
		leftAtSource: attribution.leftAt?.source ?? null,
		consequencesFrom: attribution.consequencesFrom.toString(),
		actorUserId: attribution.actorUserId,
		plan,
		deactivationId,
	};
}

/**
 * Backfills one employee through the non-interactive deactivation, which
 * takes the deactivation's locks and re-checks that the employee still needs
 * it. A recovered instant is when they left; without one it is not recorded.
 */
async function applyOne(
	database: Database,
	input: { organizationId: string; attribution: Attribution; clock?: Clock },
) {
	const { attribution } = input;
	const { leftAt } = attribution;
	return runNonInteractiveDeactivation(database, {
		organizationId: input.organizationId,
		employeeId: attribution.candidate.employeeId,
		actorUserId: attribution.actorUserId,
		reason: BACKFILL_REASON,
		deactivatedAt: leftAt?.at ?? null,
		consequencesFrom: attribution.consequencesFrom,
		// The history shows the recovered deactivation once, not again as its source audit entry.
		metadata: leftAt ? { leftAtSource: leftAt.source, sourceAuditId: leftAt.auditId } : undefined,
		// The checklist says "not recorded" for a backfilled row without a left-on date.
		result: {
			backfill: {
				leftAt: leftAt ? leftAt.at.toString() : null,
				leftAtSource: leftAt?.source ?? null,
			},
		},
		clock: input.clock,
	});
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
			const attribution = await attribute(database, {
				organizationId,
				candidate,
				runAt: options.runAt,
			});
			if ("error" in attribution) {
				fail(attribution.error);
				continue;
			}
			if (!options.apply) {
				const { plan } = await planNonInteractiveDeactivation(database, {
					organizationId,
					employeeId: candidate.employeeId,
					at: attribution.consequencesFrom,
				});
				report.employees.push(reportEntry(attribution, plan, null));
				continue;
			}
			const outcome = await applyOne(database, {
				organizationId,
				attribution,
				clock: options.clock,
			});
			if (outcome.kind !== "applied") continue;
			report.employees.push(reportEntry(attribution, outcome.plan, outcome.deactivationId));
			for (const message of outcome.warnings) {
				report.warnings.push({ employeeId: candidate.employeeId, message });
			}
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
