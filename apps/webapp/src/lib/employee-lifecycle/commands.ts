import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	employee,
	employeeEmploymentHistory,
	employeeManagers,
	workPolicyAssignment,
} from "@/db/schema";
import {
	employeeDeparture,
	employeeDepartureEvent,
	employeeDepartureTask,
	employeeEmploymentPeriod,
} from "@/db/schema/employee-lifecycle";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { departureCutoff } from "./cutoff";
import { assertReadCommitted, lockLifecycleEmployee, lockLifecycleOrganization } from "./locks";
import { type DepartureBlockedReason, evaluateDepartureAuthority } from "./owner-invariant";
import { executeDepartureInTransaction } from "./transition";
import type {
	CancelDeparture,
	DepartureClockOutPort,
	DepartureIdentity,
	ExecuteDepartureResult,
	LifecycleActor,
	LifecycleTransaction,
	OffboardNow,
	RehireEmployee,
	ScheduleDeparture,
} from "./types";

export type DepartureCommandErrorCode =
	| DepartureBlockedReason
	| "actor_not_authorized"
	| "self_target"
	| "employee_not_found"
	| "no_open_employment_period"
	| "departure_already_pending"
	| "departure_revision_conflict"
	| "departure_already_effective"
	| "departure_date_in_past"
	| "invalid_timezone"
	| "replacement_invalid"
	| "replacement_required"
	| "request_conflict"
	| "membership_required"
	| "employee_already_employed"
	| "rehire_conflict"
	| "rehire_terms_invalid";

export class DepartureCommandError extends Error {
	constructor(readonly code: DepartureCommandErrorCode) {
		super(code);
		this.name = "DepartureCommandError";
	}
}

/** Root database handle; commands own their transaction and must not nest. */
export type LifecycleDatabase = Pick<typeof rootDatabase, "transaction">;

export type DepartureCommandDependencies = {
	db: LifecycleDatabase;
	clock: Clock;
	clockOut: DepartureClockOutPort;
};

type ScheduleResult = { departureId: string; revision: number };

export function createDepartureCommands(deps: DepartureCommandDependencies) {
	return {
		scheduleDeparture: async (actor: LifecycleActor, input: ScheduleDeparture) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return scheduleDeparture(deps, actor, input);
		},
		cancelDeparture: async (actor: LifecycleActor, input: CancelDeparture) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return cancelDeparture(deps, actor, input);
		},
		offboardNow: async (actor: LifecycleActor, input: OffboardNow) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return offboardNow(deps, actor, input);
		},
		executeDeparture: (identity: DepartureIdentity) => executeDeparture(deps, identity),
		rehireEmployee: async (actor: LifecycleActor, input: RehireEmployee) => {
			await materializeDueDeparture(deps, actor.organizationId, input.employeeId);
			return rehireEmployee(deps, actor, input);
		},
	};
}

function executeDeparture(
	deps: DepartureCommandDependencies,
	identity: DepartureIdentity,
): Promise<ExecuteDepartureResult> {
	return deps.db.transaction((tx) =>
		executeDepartureInTransaction(tx, identity, deps.clock.nowInstant(), deps.clockOut),
	);
}

/**
 * A departure whose cutoff has passed takes effect before any further
 * lifecycle command is admitted. It commits in its own transaction so a later
 * command failure cannot roll the effective departure back.
 */
async function materializeDueDeparture(
	deps: DepartureCommandDependencies,
	organizationId: string,
	employeeId: string,
): Promise<void> {
	await deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		await assertReadCommitted(tx);
		await lockLifecycleOrganization(tx, organizationId);
		await lockLifecycleEmployee(tx, employeeId);
		const [due] = await tx
			.select({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
				employmentPeriodId: employeeDeparture.employmentPeriodId,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, organizationId),
					eq(employeeDeparture.employeeId, employeeId),
					eq(employeeDeparture.status, "pending"),
					lte(employeeDeparture.cutoffAt, dateFromInstant(now)),
				),
			);
		if (!due) return;
		await executeDepartureInTransaction(
			tx,
			{
				organizationId,
				employeeId,
				employmentPeriodId: due.employmentPeriodId,
				departureId: due.id,
				revision: due.revision,
			},
			now,
			deps.clockOut,
		);
	});
}

async function scheduleDeparture(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: ScheduleDeparture,
): Promise<ScheduleResult> {
	const fingerprint = requestFingerprint(actor, "schedule_departure", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<ScheduleResult>(tx, actor, input.requestId, fingerprint);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		await assertReplacementChoice(tx, actor.organizationId, target.id, input);
		const periodId = await ensureOpenEmploymentPeriod(tx, actor.organizationId, target.id);
		const cutoff = await resolveCutoff(tx, actor.organizationId, input.lastWorkingDay, now);
		const nowDate = dateFromInstant(now);
		if (input.expectedRevision !== null) {
			return reviseDeparture(tx, {
				actor,
				targetId: target.id,
				periodId,
				input,
				cutoff,
				fingerprint,
				nowDate,
			});
		}

		const [pending] = await tx
			.select({ id: employeeDeparture.id })
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.status, "pending"),
				),
			);
		if (pending) throw new DepartureCommandError("departure_already_pending");

		const [created] = await tx
			.insert(employeeDeparture)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: periodId,
				mode: "scheduled",
				lastWorkingDay: cutoff.lastWorkingDay,
				timezone: cutoff.timezone,
				cutoffAt: dateFromInstant(cutoff.cutoff),
				replacementEmployeeId: input.replacementEmployeeId,
				acknowledgeUnassignedDuties: input.acknowledgeUnassignedDuties,
				revision: 1,
				status: "pending",
				createdBy: actor.userId,
				requestId: input.requestId,
				requestFingerprint: fingerprint,
				createdAt: nowDate,
				updatedAt: nowDate,
			})
			.returning({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
			});
		if (!created) throw new Error("departure_not_created");

		const result = { departureId: created.id, revision: created.revision };
		await persistDispatchIntent(tx, {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: created.revision,
		});
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: created.revision,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_scheduled",
			occurredAt: nowDate,
			result,
		});
		return result;
	});
}

/**
 * Edits a pending departure, or reschedules a blocked one, as a new revision.
 * The editing admin becomes the initiator whose authority execution re-checks;
 * the prior blocked outcome remains in the append-only audit trail.
 */
async function reviseDeparture(
	tx: LifecycleTransaction,
	input: {
		actor: LifecycleActor;
		targetId: string;
		periodId: string;
		input: ScheduleDeparture;
		cutoff: { lastWorkingDay: string; timezone: string; cutoff: Instant };
		fingerprint: string;
		nowDate: Date;
	},
): Promise<ScheduleResult> {
	const { actor } = input;
	const [departure] = await tx
		.update(employeeDeparture)
		.set({
			status: "pending",
			mode: "scheduled",
			lastWorkingDay: input.cutoff.lastWorkingDay,
			timezone: input.cutoff.timezone,
			cutoffAt: dateFromInstant(input.cutoff.cutoff),
			replacementEmployeeId: input.input.replacementEmployeeId,
			acknowledgeUnassignedDuties: input.input.acknowledgeUnassignedDuties,
			revision: sql`${employeeDeparture.revision} + 1`,
			createdBy: actor.userId,
			blockedReason: null,
			processedAt: null,
			updatedAt: input.nowDate,
		})
		.where(
			and(
				eq(employeeDeparture.organizationId, actor.organizationId),
				eq(employeeDeparture.employeeId, input.targetId),
				eq(employeeDeparture.employmentPeriodId, input.periodId),
				eq(employeeDeparture.revision, input.input.expectedRevision ?? 0),
				inArray(employeeDeparture.status, ["pending", "blocked"]),
			),
		)
		.returning({
			id: employeeDeparture.id,
			revision: employeeDeparture.revision,
		});
	if (!departure) throw new DepartureCommandError("departure_revision_conflict");

	const result = { departureId: departure.id, revision: departure.revision };
	await persistDispatchIntent(tx, {
		organizationId: actor.organizationId,
		employeeId: input.targetId,
		employmentPeriodId: input.periodId,
		departureId: departure.id,
		revision: departure.revision,
	});
	await writeReceipt(tx, {
		actor,
		employeeId: input.targetId,
		employmentPeriodId: input.periodId,
		departureId: departure.id,
		revision: departure.revision,
		requestId: input.input.requestId,
		fingerprint: input.fingerprint,
		kind: "departure_rescheduled",
		occurredAt: input.nowDate,
		result,
	});
	return result;
}

async function cancelDeparture(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: CancelDeparture,
): Promise<void> {
	const fingerprint = requestFingerprint(actor, "cancel_departure", input);
	await deps.db.transaction(async (tx) => {
		const nowDate = dateFromInstant(deps.clock.nowInstant());
		const target = await beginCommand(tx, actor, input.employeeId);
		if (await readReceipt(tx, actor, input.requestId, fingerprint)) return;
		await assertActorMayManage(tx, actor, target);

		const [departure] = await tx
			.select({
				status: employeeDeparture.status,
				employmentPeriodId: employeeDeparture.employmentPeriodId,
			})
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.id, input.departureId),
				),
			);
		if (!departure) throw new DepartureCommandError("departure_revision_conflict");
		if (departure.status === "effective") {
			// An effective departure is restored only through rehire.
			throw new DepartureCommandError("departure_already_effective");
		}

		const canceled = await tx.execute<{ revision: number }>(sql`
			UPDATE employee_departure
			SET status = 'canceled', revision = revision + 1, updated_at = ${nowDate}
			WHERE organization_id = ${actor.organizationId} AND employee_id = ${target.id}
				AND id = ${input.departureId} AND revision = ${input.expectedRevision}
				AND (status = 'blocked' OR (status = 'pending' AND cutoff_at > ${nowDate}))
			RETURNING revision
		`);
		const revision = canceled.rows[0]?.revision;
		if (revision === undefined) throw new DepartureCommandError("departure_revision_conflict");

		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: departure.employmentPeriodId,
			departureId: input.departureId,
			revision,
			requestId: input.requestId,
			fingerprint,
			kind: "departure_canceled",
			occurredAt: nowDate,
			result: { departureId: input.departureId, revision },
		});
	});
}

/**
 * Captures the effective instant once, supersedes any pending schedule in the
 * same serialized transition and executes immediately. A retried request
 * returns the recorded result rather than re-reading the clock.
 */
async function offboardNow(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: OffboardNow,
): Promise<ExecuteDepartureResult> {
	const fingerprint = requestFingerprint(actor, "offboard_now", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<ExecuteDepartureResult>(
			tx,
			actor,
			input.requestId,
			fingerprint,
		);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		await assertReplacementChoice(tx, actor.organizationId, target.id, input);
		const periodId = await ensureOpenEmploymentPeriod(tx, actor.organizationId, target.id);

		const superseded = await tx
			.update(employeeDeparture)
			.set({
				status: "canceled",
				revision: sql`${employeeDeparture.revision} + 1`,
				updatedAt: nowDate,
			})
			.where(
				and(
					eq(employeeDeparture.organizationId, actor.organizationId),
					eq(employeeDeparture.employeeId, target.id),
					eq(employeeDeparture.status, "pending"),
				),
			)
			.returning({
				id: employeeDeparture.id,
				revision: employeeDeparture.revision,
			});

		const [org] = await tx
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, actor.organizationId));
		const [created] = await tx
			.insert(employeeDeparture)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: periodId,
				mode: "immediate",
				lastWorkingDay: null,
				timezone: org?.timezone ?? "UTC",
				cutoffAt: nowDate,
				replacementEmployeeId: input.replacementEmployeeId,
				acknowledgeUnassignedDuties: input.acknowledgeUnassignedDuties,
				revision: 1,
				status: "pending",
				createdBy: actor.userId,
				requestId: input.requestId,
				requestFingerprint: fingerprint,
				createdAt: nowDate,
				updatedAt: nowDate,
			})
			.returning({ id: employeeDeparture.id });
		if (!created) throw new Error("departure_not_created");

		const identity = {
			organizationId: actor.organizationId,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: 1,
		};
		const result = await executeDepartureInTransaction(tx, identity, now, deps.clockOut);

		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: periodId,
			departureId: created.id,
			revision: 1,
			requestId: input.requestId,
			fingerprint,
			kind: result.status === "blocked" ? "departure_blocked" : "departure_effective",
			occurredAt: nowDate,
			result,
			metadata: { mode: "immediate" },
		});
		for (const [index, previous] of superseded.entries()) {
			await writeReceipt(tx, {
				actor,
				employeeId: target.id,
				employmentPeriodId: periodId,
				departureId: previous.id,
				revision: previous.revision,
				requestId: input.requestId,
				fingerprint,
				kind: "departure_superseded",
				occurredAt: nowDate,
				result: {},
				eventIndex: index + 1,
				metadata: { supersededBy: created.id },
			});
		}
		return result;
	});
}

/**
 * The replacement must be another active, approved member of the same
 * organization. Selecting one grants no authority; per-assignment eligibility
 * is re-checked at handover. Outstanding approval duties require either a
 * replacement or explicit acknowledgment that admins will resolve them.
 */
async function assertReplacementChoice(
	tx: LifecycleTransaction,
	organizationId: string,
	targetId: string,
	input: {
		replacementEmployeeId: string | null;
		acknowledgeUnassignedDuties: boolean;
	},
) {
	if (input.replacementEmployeeId !== null) {
		if (input.replacementEmployeeId === targetId) {
			throw new DepartureCommandError("replacement_invalid");
		}
		const eligible = await tx.execute(sql`
			SELECT 1 FROM employee e
			JOIN member m ON m.user_id = e.user_id AND m.organization_id = e.organization_id
			WHERE e.organization_id = ${organizationId} AND e.id = ${input.replacementEmployeeId}
				AND e.is_active = true AND m.status = 'approved'
		`);
		if (eligible.rows.length === 0) throw new DepartureCommandError("replacement_invalid");
		return;
	}
	if (input.acknowledgeUnassignedDuties) return;
	const duties = await tx.execute(sql`
		SELECT 1 FROM approval_stage_assignment
		WHERE organization_id = ${organizationId} AND approver_employee_id = ${targetId}
			AND status = 'pending'
		LIMIT 1
	`);
	if (duties.rows.length > 0) throw new DepartureCommandError("replacement_required");
}

type RehireResult = { employmentPeriodId: string };

/**
 * Starts a new employment period at one server instant on the existing
 * profile. Every term, the role, team, manager and work policy come from the
 * confirmed input; nothing from the previous stint is restored implicitly.
 * Approved membership is required before access returns, and billing
 * recomputes the current seat count rather than applying an increment.
 */
async function rehireEmployee(
	deps: DepartureCommandDependencies,
	actor: LifecycleActor,
	input: RehireEmployee,
): Promise<RehireResult> {
	const fingerprint = requestFingerprint(actor, "rehire_employee", input);
	return deps.db.transaction(async (tx) => {
		const now = deps.clock.nowInstant();
		const nowDate = dateFromInstant(now);
		const target = await beginCommand(tx, actor, input.employeeId);
		const replay = await readReceipt<RehireResult>(tx, actor, input.requestId, fingerprint);
		if (replay) return replay;

		await assertActorMayDepart(tx, actor, target);
		const membership = await tx.execute(sql`
			SELECT 1 FROM member
			WHERE organization_id = ${actor.organizationId} AND user_id = ${target.userId}
				AND status = 'approved'
		`);
		if (membership.rows.length === 0) throw new DepartureCommandError("membership_required");

		const periods = await tx
			.select({
				id: employeeEmploymentPeriod.id,
				status: employeeEmploymentPeriod.status,
				endedAt: employeeEmploymentPeriod.endedAt,
			})
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
				),
			);
		if (periods.some((period) => period.status === "open")) {
			throw new DepartureCommandError("employee_already_employed");
		}
		// The confirmed previous stint must be the one an effective departure ended.
		const [previous] = await tx
			.select({ endedAt: employeeEmploymentPeriod.endedAt })
			.from(employeeEmploymentPeriod)
			.innerJoin(
				employeeDeparture,
				and(
					eq(employeeDeparture.organizationId, employeeEmploymentPeriod.organizationId),
					eq(employeeDeparture.employmentPeriodId, employeeEmploymentPeriod.id),
					eq(employeeDeparture.status, "effective"),
				),
			)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
					eq(employeeEmploymentPeriod.employeeId, target.id),
					eq(employeeEmploymentPeriod.id, input.previousEmploymentPeriodId),
					eq(employeeEmploymentPeriod.status, "closed"),
				),
			)
			.orderBy(desc(employeeDeparture.effectiveAt))
			.limit(1);
		const latestEnd = periods
			.map((period) => period.endedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
			.reduce((latest, end) => Math.max(latest, end), Number.NEGATIVE_INFINITY);
		if (!previous?.endedAt || previous.endedAt.getTime() !== latestEnd) {
			throw new DepartureCommandError("rehire_conflict");
		}
		if (previous.endedAt.getTime() > nowDate.getTime()) {
			throw new DepartureCommandError("rehire_conflict");
		}

		await assertRehireTermsBelongToOrganization(tx, actor.organizationId, target.id, input);
		const timezone = await organizationTimezone(tx, actor.organizationId);

		const [period] = await tx
			.insert(employeeEmploymentPeriod)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				status: "open",
				startedAt: nowDate,
				startProvenance: "recorded",
				createdAt: nowDate,
				createdBy: actor.userId,
			})
			.returning({ id: employeeEmploymentPeriod.id });
		if (!period) throw new Error("employment_period_not_created");

		await tx.insert(employeeEmploymentHistory).values({
			employeeId: target.id,
			organizationId: actor.organizationId,
			employmentPeriodId: period.id,
			validFrom: nowDate,
			validUntil: null,
			status: "active",
			contractType: input.contractType,
			weeklyContractMinutes: input.weeklyContractMinutes,
			probationStartsOn: localDateStart(input.probationStartsOn, timezone),
			probationEndsOn: localDateStart(input.probationEndsOn, timezone),
			workModel: input.workModel,
			workPolicyId: input.workPolicyId,
			hourlyRate: input.hourlyRate ?? null,
			currency: input.currency,
			changeReason: input.changeReason,
			reviewState: "confirmed",
			createdBy: actor.userId,
			createdAt: nowDate,
			updatedBy: actor.userId,
			updatedAt: nowDate,
		});
		await tx.insert(workPolicyAssignment).values({
			policyId: input.workPolicyId,
			organizationId: actor.organizationId,
			assignmentType: "employee",
			employeeId: target.id,
			priority: 2,
			effectiveFrom: nowDate,
			effectiveUntil: null,
			isActive: true,
			createdBy: actor.userId,
			createdAt: nowDate,
			updatedAt: nowDate,
		});

		await tx.delete(employeeManagers).where(eq(employeeManagers.employeeId, target.id));
		if (input.primaryManagerId) {
			await tx.insert(employeeManagers).values({
				employeeId: target.id,
				managerId: input.primaryManagerId,
				isPrimary: true,
				assignedBy: actor.userId,
				assignedAt: nowDate,
				createdAt: nowDate,
			});
		}
		await tx
			.update(employee)
			.set({
				isActive: true,
				role: input.role,
				teamId: input.teamId,
				contractType: input.contractType,
				currentHourlyRate: input.hourlyRate ?? null,
				endDate: null,
				updatedAt: nowDate,
			})
			.where(and(eq(employee.organizationId, actor.organizationId), eq(employee.id, target.id)));

		await tx
			.insert(employeeDepartureTask)
			.values({
				organizationId: actor.organizationId,
				employeeId: target.id,
				employmentPeriodId: period.id,
				departureId: null,
				kind: "billing_sync",
				dedupeKey: `billing:rehire:${period.id}`,
			})
			.onConflictDoNothing();

		const result = { employmentPeriodId: period.id };
		await writeReceipt(tx, {
			actor,
			employeeId: target.id,
			employmentPeriodId: period.id,
			departureId: null,
			revision: null,
			requestId: input.requestId,
			fingerprint,
			kind: "employee_rehired",
			occurredAt: nowDate,
			result,
			metadata: { previousEmploymentPeriodId: input.previousEmploymentPeriodId },
		});
		return result;
	});
}

/** Team, manager and work policy must all belong to the same organization. */
async function assertRehireTermsBelongToOrganization(
	tx: LifecycleTransaction,
	organizationId: string,
	employeeId: string,
	input: RehireEmployee,
) {
	if (input.contractType === "hourly" && !input.hourlyRate) {
		throw new DepartureCommandError("rehire_terms_invalid");
	}
	const facts = await tx.execute<{
		policy_ok: boolean;
		team_ok: boolean;
		manager_ok: boolean;
	}>(sql`
		SELECT
			EXISTS (
				SELECT 1 FROM work_policy
				WHERE id = ${input.workPolicyId}::uuid AND organization_id = ${organizationId}
			) AS policy_ok,
			(${input.teamId}::uuid IS NULL OR EXISTS (
				SELECT 1 FROM team WHERE id = ${input.teamId}::uuid AND organization_id = ${organizationId}
			)) AS team_ok,
			(${input.primaryManagerId}::uuid IS NULL OR EXISTS (
				SELECT 1 FROM employee
				WHERE id = ${input.primaryManagerId}::uuid AND organization_id = ${organizationId}
					AND is_active = true AND id <> ${employeeId}
			)) AS manager_ok
	`);
	const checks = facts.rows[0];
	if (!checks?.policy_ok || !checks.team_ok || !checks.manager_ok) {
		throw new DepartureCommandError("rehire_terms_invalid");
	}
}

async function organizationTimezone(tx: LifecycleTransaction, organizationId: string) {
	const [org] = await tx
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId));
	return org?.timezone ?? "UTC";
}

/** ISO calendar date interpreted at its start of day in the organization zone. */
function localDateStart(value: string | null, timezone: string): Date | null {
	if (!value) return null;
	return dateFromInstant(parsePlainDate(value).toZonedDateTime(timezone).toInstant());
}

type CommandTarget = { id: string; userId: string };

async function beginCommand(
	tx: LifecycleTransaction,
	actor: LifecycleActor,
	employeeId: string,
): Promise<CommandTarget> {
	await assertReadCommitted(tx);
	await lockLifecycleOrganization(tx, actor.organizationId);
	await lockLifecycleEmployee(tx, employeeId);
	const [target] = await tx
		.select({ id: employee.id, userId: employee.userId })
		.from(employee)
		.where(and(eq(employee.organizationId, actor.organizationId), eq(employee.id, employeeId)));
	if (!target) throw new DepartureCommandError("employee_not_found");
	return target;
}

/**
 * Actor authority is loaded server-side under the organization lock; holding
 * an employee or departure ID never implies it.
 */
async function assertActorMayDepart(
	tx: LifecycleTransaction,
	actor: LifecycleActor,
	target: CommandTarget,
) {
	if (target.userId === actor.userId) throw new DepartureCommandError("self_target");
	const reason = await evaluateDepartureAuthority(tx, {
		organizationId: actor.organizationId,
		targetUserId: target.userId,
		initiatorUserId: actor.userId,
	});
	if (reason === "initiator_authorization_lost") {
		throw new DepartureCommandError("actor_not_authorized");
	}
	if (reason) throw new DepartureCommandError(reason);
}

/** Cancelling needs owner/admin authority but not the final-owner invariant. */
async function assertActorMayManage(
	tx: LifecycleTransaction,
	actor: LifecycleActor,
	target: CommandTarget,
) {
	if (target.userId === actor.userId) throw new DepartureCommandError("self_target");
	const reason = await evaluateDepartureAuthority(tx, {
		organizationId: actor.organizationId,
		targetUserId: target.userId,
		initiatorUserId: actor.userId,
	});
	if (reason === "initiator_authorization_lost") {
		throw new DepartureCommandError("actor_not_authorized");
	}
	if (reason === "owner_authorization_required") throw new DepartureCommandError(reason);
}

async function ensureOpenEmploymentPeriod(
	tx: LifecycleTransaction,
	organizationId: string,
	employeeId: string,
): Promise<string> {
	// Employees created after migration 0069 receive their legacy period lazily.
	await tx.execute(
		sql`SELECT employee_employment_period_backfill_legacy(${organizationId}, ${employeeId}::uuid)`,
	);
	const [period] = await tx
		.select({ id: employeeEmploymentPeriod.id })
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				eq(employeeEmploymentPeriod.employeeId, employeeId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		);
	if (!period) throw new DepartureCommandError("no_open_employment_period");
	return period.id;
}

async function resolveCutoff(
	tx: LifecycleTransaction,
	organizationId: string,
	lastWorkingDay: string,
	now: Instant,
) {
	const [org] = await tx
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId));
	try {
		return departureCutoff({
			lastWorkingDay,
			timezone: org?.timezone ?? null,
			now,
		});
	} catch (error) {
		if (error instanceof Error && error.message === "departure_date_in_past") {
			throw new DepartureCommandError("departure_date_in_past");
		}
		if (error instanceof RangeError && /time ?zone/i.test(error.message)) {
			throw new DepartureCommandError("invalid_timezone");
		}
		throw error;
	}
}

async function persistDispatchIntent(
	tx: LifecycleTransaction,
	identity: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string;
		revision: number;
	},
) {
	await tx
		.insert(employeeDepartureTask)
		.values({
			organizationId: identity.organizationId,
			employeeId: identity.employeeId,
			employmentPeriodId: identity.employmentPeriodId,
			departureId: identity.departureId,
			kind: "dispatch_departure",
			dedupeKey: `dispatch:${identity.departureId}:${identity.revision}`,
			payload: { revision: identity.revision },
		})
		.onConflictDoNothing();
}

/** Stable SHA-256 over actor, command and canonical (key-sorted) input. */
export function requestFingerprint(actor: LifecycleActor, command: string, input: object): string {
	const canonical = JSON.stringify({
		actor: actor.userId,
		command,
		input: sortKeys(input),
	});
	return createHash("sha256").update(canonical).digest("hex");
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, sortKeys(entry)]),
		);
	}
	return value;
}

/**
 * A request receipt is event index 0 for the request. Replaying the same
 * payload returns the original result; a different payload under the same
 * request ID is rejected.
 */
async function readReceipt<T>(
	tx: LifecycleTransaction,
	actor: LifecycleActor,
	requestId: string,
	fingerprint: string,
): Promise<T | null> {
	const [receipt] = await tx
		.select({
			fingerprint: employeeDepartureEvent.requestFingerprint,
			result: employeeDepartureEvent.result,
		})
		.from(employeeDepartureEvent)
		.where(
			and(
				eq(employeeDepartureEvent.organizationId, actor.organizationId),
				eq(employeeDepartureEvent.requestId, requestId),
				eq(employeeDepartureEvent.eventIndex, 0),
			),
		);
	if (!receipt) return null;
	if (receipt.fingerprint !== fingerprint) throw new DepartureCommandError("request_conflict");
	return receipt.result as T;
}

async function writeReceipt(
	tx: LifecycleTransaction,
	input: {
		actor: LifecycleActor;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string | null;
		revision: number | null;
		requestId: string;
		fingerprint: string;
		kind: typeof employeeDepartureEvent.$inferInsert.kind;
		occurredAt: Date;
		result: Record<string, unknown>;
		eventIndex?: number;
		metadata?: Record<string, unknown>;
	},
) {
	await tx.insert(employeeDepartureEvent).values({
		organizationId: input.actor.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId: input.employmentPeriodId,
		departureId: input.departureId,
		requestId: input.requestId,
		eventIndex: input.eventIndex ?? 0,
		revision: input.revision,
		kind: input.kind,
		actorUserId: input.actor.userId,
		occurredAt: input.occurredAt,
		metadata: input.metadata ?? {},
		requestFingerprint: input.eventIndex ? null : input.fingerprint,
		result: input.eventIndex ? null : input.result,
	});
}
