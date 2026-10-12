import "server-only";

import { and, asc, eq, gte, inArray, lte, ne, or } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { type AuditInsertClient, type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { loadApprovalSettings } from "@/lib/approvals/approval-settings";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import type { EmployeeRole } from "@/lib/validations/employee";
import {
	type AbsenceDeputyView,
	canDeputyDecideApprovals,
	checkDeputyChangeAccess,
	checkDeputyForAbsence,
	type DeputyCandidateFacts,
	type DeputyRefusal,
	deputyAwayPeriods,
	type PlainDateSpan,
} from "./deputy";
import { loadAbsentEmployeeTodays } from "./deputy-missing-store";
import { notifyAbsenceDeputies } from "./deputy-notifier";
import { loadManagedEmployeeIds } from "./managed-employees";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** The named employee, only when they belong to the organization. */
export async function loadDeputyCandidate(
	executor: Pick<Executor, "select">,
	input: { organizationId: string; deputyEmployeeId: string },
): Promise<DeputyCandidateFacts | null> {
	const [row] = await executor
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			isActive: employeeHasOrganizationAccess(),
		})
		.from(employee)
		.where(
			and(
				eq(employee.id, input.deputyEmployeeId),
				eq(employee.organizationId, input.organizationId),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Whether an absence may name this deputy (or none), loading the deputy. */
export async function checkDeputyNaming(
	executor: Pick<Executor, "select">,
	input: {
		organizationId: string;
		absentEmployeeId: string;
		deputyEmployeeId: string | null | undefined;
		deputyRequired: boolean;
	},
): Promise<DeputyRefusal | null> {
	// A malformed id names nobody: refused as unavailable, never sent to the database.
	const deputy =
		input.deputyEmployeeId &&
		input.deputyEmployeeId !== input.absentEmployeeId &&
		isCanonicalUuid(input.deputyEmployeeId)
			? await loadDeputyCandidate(executor, {
					organizationId: input.organizationId,
					deputyEmployeeId: input.deputyEmployeeId,
				})
			: null;
	return checkDeputyForAbsence({ ...input, deputy });
}

/** One audit entry per naming, change or removal, inside the write's transaction. */
export async function recordDeputyChange(
	audit: AuditTrail,
	tx: AuditInsertClient,
	input: {
		organizationId: string;
		absenceId: string;
		absentEmployeeId: string;
		actorUserId: string;
		from: string | null;
		to: string | null;
		/** Why a system side effect changed it, for example a departure (#1014). */
		metadata?: Record<string, unknown>;
	},
): Promise<void> {
	await audit.record(tx, {
		organizationId: input.organizationId,
		action: AuditAction.ABSENCE_DEPUTY_CHANGED,
		actorUserId: input.actorUserId,
		targetType: "absence",
		targetId: input.absenceId,
		employeeId: input.absentEmployeeId,
		changes: { deputyEmployeeId: { from: input.from, to: input.to } },
		metadata: input.metadata ?? null,
	});
}

export type ChangeAbsenceDeputyResult =
	| { kind: "changed"; deputyEmployeeId: string | null }
	| { kind: "unchanged"; deputyEmployeeId: string | null }
	/** Missing, in another organization, or not the actor's to change. */
	| { kind: "not_found" }
	| { kind: "absence_closed" }
	| { kind: "refused"; refusal: DeputyRefusal };

/**
 * Changes the deputy of an existing absence (#1011). The absent employee,
 * their managers and admins may, until the absence has ended; it needs no new
 * approval. A required deputy can be swapped but not removed.
 */
export async function changeAbsenceDeputy(
	database: Database,
	input: {
		organizationId: string;
		absenceId: string;
		deputyEmployeeId: string | null;
		actor: { employeeId: string; userId: string; role: EmployeeRole };
		/** Now: the absence ends after its last day in the absent employee's timezone. */
		at: Instant;
	},
): Promise<ChangeAbsenceDeputyResult> {
	let previousDeputyEmployeeId: string | null = null;
	const result = await withAuditTrail((audit) =>
		database.transaction(async (tx): Promise<ChangeAbsenceDeputyResult> => {
			const [absence] = await tx
				.select({
					id: absenceEntry.id,
					employeeId: absenceEntry.employeeId,
					status: absenceEntry.status,
					endDate: absenceEntry.endDate,
					deputyEmployeeId: absenceEntry.deputyEmployeeId,
					deputyRequired: absenceCategory.deputyRequired,
				})
				.from(absenceEntry)
				.innerJoin(absenceCategory, eq(absenceCategory.id, absenceEntry.categoryId))
				.where(
					and(
						eq(absenceEntry.id, input.absenceId),
						eq(absenceEntry.organizationId, input.organizationId),
					),
				)
				.for("update", { of: absenceEntry });
			if (!absence) return { kind: "not_found" };

			const [managed, todays] = await Promise.all([
				input.actor.role === "manager"
					? loadManagedEmployeeIds(tx, {
							organizationId: input.organizationId,
							managerEmployeeId: input.actor.employeeId,
							employeeIds: [absence.employeeId],
						})
					: new Set<string>(),
				loadAbsentEmployeeTodays(tx, {
					organizationId: input.organizationId,
					employeeIds: [absence.employeeId],
					at: input.at,
				}),
			]);
			const access = checkDeputyChangeAccess({
				actor: { ...input.actor, managesAbsentEmployee: managed.has(absence.employeeId) },
				absence,
				today: todays.get(absence.employeeId) ?? plainDateAt(input.at, "UTC").toString(),
			});
			if (access === "forbidden") return { kind: "not_found" };
			if (access === "absence_closed") return { kind: "absence_closed" };

			const refusal = await checkDeputyNaming(tx, {
				organizationId: input.organizationId,
				absentEmployeeId: absence.employeeId,
				deputyEmployeeId: input.deputyEmployeeId,
				deputyRequired: absence.deputyRequired,
			});
			if (refusal) return { kind: "refused", refusal };
			if (absence.deputyEmployeeId === input.deputyEmployeeId) {
				return { kind: "unchanged", deputyEmployeeId: input.deputyEmployeeId };
			}

			await tx
				.update(absenceEntry)
				.set({
					deputyEmployeeId: input.deputyEmployeeId,
					deputyAssignedAt: input.deputyEmployeeId ? currentTimestamp() : null,
				})
				.where(
					and(
						eq(absenceEntry.id, absence.id),
						eq(absenceEntry.organizationId, input.organizationId),
					),
				);
			await recordDeputyChange(audit, tx, {
				organizationId: input.organizationId,
				absenceId: absence.id,
				absentEmployeeId: absence.employeeId,
				actorUserId: input.actor.userId,
				from: absence.deputyEmployeeId,
				to: input.deputyEmployeeId,
			});
			previousDeputyEmployeeId = absence.deputyEmployeeId;
			return { kind: "changed", deputyEmployeeId: input.deputyEmployeeId };
		}),
	);
	if (result.kind === "changed") {
		// After the commit: on an approved absence the old deputy is told they
		// were removed and the new one that they were named (#1013).
		await notifyAbsenceDeputies(database, {
			organizationId: input.organizationId,
			events: [
				{
					kind: "deputy_changed",
					absenceId: input.absenceId,
					changeId: crypto.randomUUID(),
					from: previousDeputyEmployeeId,
					to: result.deputyEmployeeId,
				},
			],
		});
	}
	return result;
}

export interface DeputyCandidate {
	id: string;
	name: string;
	image: string | null;
	/** Their own absences overlapping the requested dates; never why they are away. */
	awayPeriods: PlainDateSpan[];
}

/**
 * Everyone who can be named as the absent employee's deputy (#1011): the
 * organization's active employees except the absent employee, by name, each
 * with when they are away themselves during the requested dates.
 */
export async function listDeputyCandidates(
	database: Pick<Database, "select">,
	input: {
		organizationId: string;
		absentEmployeeId: string;
		/** The requested dates; without them nobody is marked as away. */
		requested: PlainDateSpan | null;
	},
): Promise<DeputyCandidate[]> {
	const candidates = await database
		.select({ id: employee.id, name: user.name, image: user.image })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				ne(employee.id, input.absentEmployeeId),
				employeeHasOrganizationAccess(),
			),
		)
		.orderBy(asc(user.name), asc(employee.id));
	const { requested } = input;
	if (!requested) return candidates.map((candidate) => ({ ...candidate, awayPeriods: [] }));
	if (candidates.length === 0) return [];

	const absences = await database
		.select({
			employeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
		})
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				inArray(
					absenceEntry.employeeId,
					candidates.map((candidate) => candidate.id),
				),
				or(eq(absenceEntry.status, "approved"), eq(absenceEntry.status, "pending")),
				lte(absenceEntry.startDate, requested.endDate),
				gte(absenceEntry.endDate, requested.startDate),
			),
		);
	const absencesByEmployee = new Map<string, PlainDateSpan[]>();
	for (const absence of absences) {
		const spans = absencesByEmployee.get(absence.employeeId) ?? [];
		spans.push(absence);
		absencesByEmployee.set(absence.employeeId, spans);
	}
	return candidates.map((candidate) => ({
		...candidate,
		awayPeriods: deputyAwayPeriods(absencesByEmployee.get(candidate.id) ?? [], requested),
	}));
}

/**
 * Whether the deputy can decide approvals for the absent employee: deputy
 * decisions are switched on for the organization (#1015) and the deputy is
 * an active employee of it who can use the approval inbox
 * (`canDeputyDecideApprovals`). Anyone else is a contact only.
 */
export async function loadDeputyDecisionCapability(
	database: Pick<Database, "select">,
	input: { organizationId: string; deputyEmployeeId: string },
): Promise<boolean> {
	const capabilities = await loadDeputyDecisionCapabilities(database, {
		organizationId: input.organizationId,
		deputyEmployeeIds: [input.deputyEmployeeId],
	});
	return capabilities.get(input.deputyEmployeeId) ?? false;
}

/** `loadDeputyDecisionCapability` for several deputies, reading the switch once. */
async function loadDeputyDecisionCapabilities(
	database: Pick<Database, "select">,
	input: { organizationId: string; deputyEmployeeIds: readonly string[] },
): Promise<Map<string, boolean>> {
	const capabilities = new Map<string, boolean>();
	const deputyEmployeeIds = [...new Set(input.deputyEmployeeIds)];
	if (deputyEmployeeIds.length === 0) return capabilities;
	const settings = await loadApprovalSettings(database, input.organizationId);
	if (!settings.deputyDecisionsEnabled) return capabilities;
	const deputies = await database
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, deputyEmployeeIds),
				employeeHasOrganizationAccess(),
			),
		);
	// One principal per deputy: roles and custom permissions decide inbox access.
	await Promise.all(
		deputies.map(async (deputy) => {
			const principal = await loadOrganizationPrincipalContext(database, {
				userId: deputy.userId,
				organizationId: input.organizationId,
			});
			capabilities.set(
				deputy.id,
				principal.employee?.id === deputy.id && canDeputyDecideApprovals(principal),
			);
		}),
	);
	return capabilities;
}

/** An absence's deputy as its approver sees them, by deputy employee id (#1011). */
export async function loadAbsenceDeputyViews(
	database: Pick<Database, "select">,
	input: { organizationId: string; deputyEmployeeIds: readonly string[] },
): Promise<Map<string, AbsenceDeputyView>> {
	const deputyEmployeeIds = [...new Set(input.deputyEmployeeIds)];
	if (deputyEmployeeIds.length === 0) return new Map();
	const [deputies, capabilities] = await Promise.all([
		database
			.select({ id: employee.id, name: user.name })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					inArray(employee.id, deputyEmployeeIds),
				),
			),
		loadDeputyDecisionCapabilities(database, {
			organizationId: input.organizationId,
			deputyEmployeeIds,
		}),
	]);
	return new Map(
		deputies.map((deputy) => [
			deputy.id,
			{ ...deputy, canDecideApprovals: capabilities.get(deputy.id) ?? false },
		]),
	);
}

/**
 * One absence's current deputy as its approver sees them (#1011), for the
 * approval card: undefined when the absence is not the organization's, null
 * when it names nobody.
 */
export async function loadAbsenceDeputyView(
	database: Pick<Database, "select">,
	input: { organizationId: string; absenceId: string },
): Promise<AbsenceDeputyView | null | undefined> {
	const [absence] = await database
		.select({ deputyEmployeeId: absenceEntry.deputyEmployeeId })
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!absence) return undefined;
	if (!absence.deputyEmployeeId) return null;
	const views = await loadAbsenceDeputyViews(database, {
		organizationId: input.organizationId,
		deputyEmployeeIds: [absence.deputyEmployeeId],
	});
	return views.get(absence.deputyEmployeeId) ?? null;
}
