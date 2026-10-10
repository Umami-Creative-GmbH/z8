import "server-only";

import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee, userSettings } from "@/db/schema";
import { canDeputyDecideApprovals } from "@/lib/absences/deputy";
import { loadApprovalSettings } from "@/lib/approvals/approval-settings";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import type { Instant } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { type Cover, type CoverFacts, findCover, resolveCovers } from "./covering";

/**
 * Covering (#1015) read from the database: whom deputy Y covers for at an
 * instant, and whether Y covers for one approver X. The rules are in the pure
 * core `./covering.ts`; this file only loads its facts.
 *
 * Entry points, all organization-scoped (approver and deputy are employee ids):
 * - Promise, for routes, ports and transactions: `loadCoveredApprovers`,
 *   `loadCover`, `isCovering`. They take the caller's executor (the global
 *   database or a transaction) and only read, with plain selects and no locks,
 *   so a decision transaction can ask without taking another approval gate.
 * - Effect, over the caller's `DatabaseService`: `coveredApprovers`, `coverFor`.
 *
 * Pass the instant to judge, usually now; it is truncated to milliseconds.
 */

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** The global database or a transaction; covering only selects. */
export type CoveringExecutor = Pick<Database | Transaction, "select">;

export interface CoveredApproversQuery {
	organizationId: string;
	/** The deputy Y (employee id). */
	deputyId: string;
	at: Instant;
}

export interface CoverQuery extends CoveredApproversQuery {
	/** The absent approver X (employee id). */
	approverId: string;
}

/** Every approver the deputy covers for at the instant, once each. */
export async function loadCoveredApprovers(
	executor: CoveringExecutor,
	query: CoveredApproversQuery,
): Promise<Cover[]> {
	const facts = await loadCoverFacts(executor, query);
	return facts ? resolveCovers(facts) : [];
}

/**
 * The deputy's cover for this approver at the instant, with the absence that
 * makes it, or null when the deputy is not covering for them.
 */
export async function loadCover(
	executor: CoveringExecutor,
	query: CoverQuery,
): Promise<Cover | null> {
	const facts = await loadCoverFacts(executor, query);
	return facts ? findCover(facts, query.approverId) : null;
}

/** Whether the deputy covers for this approver at the instant. */
export async function isCovering(executor: CoveringExecutor, query: CoverQuery): Promise<boolean> {
	return (await loadCover(executor, query)) !== null;
}

/** A cover seen from the absent approver's side: who covers for them. */
export interface CoveringDeputy extends Cover {
	/** The deputy Y (employee id). */
	deputyId: string;
}

/**
 * The reverse lookup, for deputy cards (#1017): every deputy covering for one
 * of these approvers at the instant. Candidates come from the approvers'
 * approved absences naming a deputy; each is then judged by the same rules as
 * `loadCover`, so an inactive deputy, one without inbox access, or the switch
 * being off yields nothing.
 */
export async function loadCoveringDeputies(
	executor: CoveringExecutor,
	query: { organizationId: string; approverIds: readonly string[]; at: Instant },
): Promise<CoveringDeputy[]> {
	if (query.approverIds.length === 0) return [];
	const at = query.at.round({ smallestUnit: "millisecond", roundingMode: "trunc" });
	const utcDay = at.toZonedDateTimeISO("UTC").toPlainDate();
	const rows = await executor
		.select({
			approverId: absenceEntry.employeeId,
			deputyId: absenceEntry.deputyEmployeeId,
		})
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.organizationId, query.organizationId),
				inArray(absenceEntry.employeeId, [...query.approverIds]),
				isNotNull(absenceEntry.deputyEmployeeId),
				eq(absenceEntry.status, "approved"),
				lte(absenceEntry.startDate, utcDay.add({ days: 1 }).toString()),
				gte(absenceEntry.endDate, utcDay.subtract({ days: 1 }).toString()),
			),
		)
		.orderBy(absenceEntry.employeeId, absenceEntry.deputyEmployeeId);
	const candidates = new Map<string, { approverId: string; deputyId: string }>();
	for (const row of rows) {
		if (!row.deputyId || row.deputyId === row.approverId) continue;
		candidates.set(`${row.approverId}:${row.deputyId}`, {
			approverId: row.approverId,
			deputyId: row.deputyId,
		});
	}
	const covering: CoveringDeputy[] = [];
	for (const candidate of candidates.values()) {
		const cover = await loadCover(executor, {
			organizationId: query.organizationId,
			approverId: candidate.approverId,
			deputyId: candidate.deputyId,
			at,
		});
		if (cover) covering.push({ ...cover, deputyId: candidate.deputyId });
	}
	return covering;
}

/** `loadCoveredApprovers` over the caller's `DatabaseService`. */
export function coveredApprovers(query: CoveredApproversQuery) {
	return Effect.gen(function* () {
		const database = yield* DatabaseService;
		return yield* database.query("approvals.deputyCovering.coveredApprovers", () =>
			loadCoveredApprovers(database.db, query),
		);
	});
}

/** `loadCover` over the caller's `DatabaseService`. */
export function coverFor(query: CoverQuery) {
	return Effect.gen(function* () {
		const database = yield* DatabaseService;
		return yield* database.query("approvals.deputyCovering.coverFor", () =>
			loadCover(database.db, query),
		);
	});
}

/**
 * The core's facts, or null when the answer is "nobody" before reading any
 * absence: the switch is off, or the deputy is not an active employee of the
 * organization who can use the approval inbox.
 */
async function loadCoverFacts(
	executor: CoveringExecutor,
	query: CoveredApproversQuery & { approverId?: string },
): Promise<CoverFacts | null> {
	const { organizationId } = query;
	const at = query.at.round({ smallestUnit: "millisecond", roundingMode: "trunc" });

	const settings = await loadApprovalSettings(executor, organizationId);
	if (!settings.deputyDecisionsEnabled) return null;

	const [deputy] = await executor
		.select({ userId: employee.userId, active: employeeHasOrganizationAccess(at) })
		.from(employee)
		.where(and(eq(employee.id, query.deputyId), eq(employee.organizationId, organizationId)))
		.limit(1);
	if (!deputy?.active) return null;
	const principal = await loadOrganizationPrincipalContext(executor, {
		userId: deputy.userId,
		organizationId,
	});
	if (principal.employee?.id !== query.deputyId || !canDeputyDecideApprovals(principal)) {
		return null;
	}

	// Every timezone's local day lies within one day of the UTC day.
	const utcDay = at.toZonedDateTimeISO("UTC").toPlainDate();
	const [[org], absences] = await Promise.all([
		executor
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, organizationId))
			.limit(1),
		executor
			.select({
				id: absenceEntry.id,
				employeeId: absenceEntry.employeeId,
				deputyEmployeeId: absenceEntry.deputyEmployeeId,
				startDate: absenceEntry.startDate,
				endDate: absenceEntry.endDate,
				startPeriod: absenceEntry.startPeriod,
				endPeriod: absenceEntry.endPeriod,
				status: absenceEntry.status,
				countsAsWorkingTime: absenceCategory.requiresWorkTime,
				userTimezone: userSettings.timezone,
			})
			.from(absenceEntry)
			.innerJoin(
				absenceCategory,
				and(
					eq(absenceCategory.id, absenceEntry.categoryId),
					eq(absenceCategory.organizationId, organizationId),
				),
			)
			.innerJoin(
				employee,
				and(eq(employee.id, absenceEntry.employeeId), eq(employee.organizationId, organizationId)),
			)
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.where(
				and(
					eq(absenceEntry.organizationId, organizationId),
					eq(absenceEntry.deputyEmployeeId, query.deputyId),
					eq(absenceEntry.status, "approved"),
					query.approverId ? eq(absenceEntry.employeeId, query.approverId) : undefined,
					lte(absenceEntry.startDate, utcDay.add({ days: 1 }).toString()),
					gte(absenceEntry.endDate, utcDay.subtract({ days: 1 }).toString()),
				),
			)
			.orderBy(absenceEntry.employeeId, absenceEntry.id),
	]);

	const approvers = new Map<string, string | null>();
	for (const absence of absences) approvers.set(absence.employeeId, absence.userTimezone);

	return {
		deputyDecisionsEnabled: settings.deputyDecisionsEnabled,
		at,
		organizationTimezone: org?.timezone ?? null,
		deputy: { employeeId: query.deputyId, active: true, canUseApprovalInbox: true },
		approvers: [...approvers].map(([employeeId, userTimezone]) => ({ employeeId, userTimezone })),
		absences,
	};
}
