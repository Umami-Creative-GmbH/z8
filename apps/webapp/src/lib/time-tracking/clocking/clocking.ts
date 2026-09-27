import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { completedWorkOperation, employee, workPeriod } from "@/db/schema";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	type Instant,
} from "@/lib/datetime/temporal-core";
import { ClockingConflictError } from "../clocking-core";
import {
	attributionValue,
	type CloseActiveWorkResult,
	CompletedWorkAttributionError,
	CompletedWorkCollisionError,
} from "../close-active-work";
import { isProjectEligible } from "../project-eligibility";
import { TimeEntryAppendReviewRequiredError } from "../time-entry-append";
import { resolveTimeEntryTimezoneCapture } from "../timezone-capture";
import { workCategoryIneligibility } from "../work-category-eligibility";
import { WorkIntervalError } from "../work-duration";
import type { WorkLocationType } from "../work-location";
import {
	type ClockOutClosure,
	type ClockOutPlan,
	type ClockOutTarget,
	closeClockOut,
	planClockOut,
	replayClockOut,
} from "./clock-out";
import type { ClockFollowUps } from "./follow-ups";
import type { ClockTransactions } from "./transactions";
import type { ClockCommand, ClockOutcome, ClockOutRefusal, OperationIdentity } from "./types";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ClockingPorts = {
	clock: Clock;
	transactions: ClockTransactions;
	followUps: ClockFollowUps;
};

export type ClockLookupQuery = Pick<
	ClockCommand,
	"organizationId" | "principal" | "subject" | "identity"
>;

export type ClockLookup =
	| { found: false }
	| { found: true; kind: "close_active_work"; result: CloseActiveWorkResult };

export type Clocking = {
	/** Runs one clock command to an executed, replayed or refused outcome. */
	run(command: ClockCommand): Promise<ClockOutcome>;
	/** The committed receipt of an operation identity, without running anything. */
	lookup(query: ClockLookupQuery): Promise<ClockLookup>;
};

/** Client and derived identities name one attempt across retries; server ones never replay. */
function isReplayable(identity: OperationIdentity) {
	return identity.origin !== "server";
}

function refused(failure: ClockOutRefusal): ClockOutcome {
	return { outcome: "refused", failure };
}

/**
 * The refusal a matching commit causes: it closed the target after the first
 * replay read. Refusals inside the work transaction follow its own replay.
 */
const LATE_REFUSALS = new Set<ClockOutRefusal["code"]>(["not_clocked_in"]);

/** Why the work transaction did not commit, for errors the writers raise. */
function closureRefusal(error: unknown): ClockOutRefusal {
	if (error instanceof ClockingConflictError) return { code: "not_clocked_in" };
	if (error instanceof WorkIntervalError) return { code: "invalid_interval" };
	if (error instanceof CompletedWorkCollisionError) return { code: "collision", cause: error };
	if (error instanceof CompletedWorkAttributionError) {
		return {
			code: error.field === "projectId" ? "project_not_allowed" : "work_category_not_allowed",
		};
	}
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		return { code: "append_review_required", requirement: error.requirement };
	}
	return { code: "unconfirmed", cause: error };
}

/**
 * The Clocking module. Every clock command runs in one fixed order: authorize,
 * billing, committed replay, freshness, target and attribution eligibility, then
 * the work transaction (replay again, admission and writer, canonical record on
 * a legacy close), commit and follow-ups. Callers never see admission.
 */
export function createClocking(ports: ClockingPorts): Clocking {
	const { clock, transactions, followUps } = ports;

	async function subjectEmployee(command: ClockLookupQuery) {
		const [row] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.id, command.subject.employeeId),
					eq(employee.organizationId, command.organizationId),
				),
			)
			.limit(1);
		// Self-service only: another employee's work needs on-behalf authority.
		return row && row.userId === command.principal.userId ? row : null;
	}

	function transactionScope(plan: ClockOutPlan) {
		return {
			organizationId: plan.employee.organizationId,
			employeeId: plan.employee.id,
			userId: plan.command.principal.userId,
			submissionId: plan.command.identity.id,
		};
	}

	/** A read-only work transaction: nothing it throws wrote anything. */
	async function committedReplay(plan: ClockOutPlan): Promise<ClockOutcome | null> {
		try {
			const replay = await transactions.run(transactionScope(plan), (coordination) =>
				replayClockOut(coordination, plan),
			);
			return replay ? { outcome: "replayed", ...replay } : null;
		} catch (error) {
			return refused(
				error instanceof CompletedWorkCollisionError
					? { code: "collision", cause: error }
					: { code: "failed", cause: error },
			);
		}
	}

	async function activeTarget(plan: ClockOutPlan): Promise<ClockOutTarget | null> {
		const [period] = await db
			.select({
				id: workPeriod.id,
				startTime: workPeriod.startTime,
				workLocationType: workPeriod.workLocationType,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, plan.employee.organizationId),
					eq(workPeriod.employeeId, plan.employee.id),
					isNull(workPeriod.endTime),
				),
			)
			.limit(1);
		return period
			? {
					workPeriodId: period.id,
					startTime: period.startTime,
					workLocationType: (period.workLocationType as WorkLocationType | null) ?? null,
				}
			: null;
	}

	async function attributionRefusal(plan: ClockOutPlan): Promise<ClockOutRefusal | null> {
		const { employee: subject, command } = plan;
		const { project, workCategory } = command.body;
		if (
			project.kind === "replace" &&
			!(await isProjectEligible(
				{
					employeeId: subject.id,
					teamId: subject.teamId,
					organizationId: subject.organizationId,
				},
				project.id,
			))
		) {
			return { code: "project_not_allowed" };
		}
		if (
			workCategory.kind === "replace" &&
			(await workCategoryIneligibility({
				employeeId: subject.id,
				organizationId: subject.organizationId,
				workCategoryId: workCategory.id,
			})) !== null
		) {
			return { code: "work_category_not_allowed" };
		}
		return null;
	}

	/** Steps after committed replay; any refusal here may race a matching commit. */
	async function execute(plan: ClockOutPlan, eventInstant: Instant): Promise<ClockOutcome> {
		const { command } = plan;
		const { freshness } = command;
		if (freshness && command.at.kind === "occurred") {
			if (compareInstants(eventInstant, freshness.earliest) < 0) {
				return refused({ code: "admission_window", reason: "too_old" });
			}
			if (compareInstants(eventInstant, freshness.latest) > 0) {
				return refused({ code: "admission_window", reason: "in_future" });
			}
		}
		// A blocking holiday never refuses a clock-out: it would leave live work running.
		const target = await activeTarget(plan);
		if (!target) return refused({ code: "not_clocked_in" });
		const attribution = await attributionRefusal(plan);
		if (attribution) return refused(attribution);

		const capture = resolveTimeEntryTimezoneCapture({
			timestamp: dateFromInstant(eventInstant),
			browserTimezone: command.zone.device,
			fallbackTimezone: command.zone.fallback,
			browserSource: "browser",
			fallbackSource: "user_setting",
		});
		let closure: ClockOutClosure;
		try {
			closure = await transactions.run(
				{
					...transactionScope(plan),
					workPeriodId: target.workPeriodId,
					endTime: eventInstant,
					projectId: attributionValue(command.body.project),
					workCategoryId: attributionValue(command.body.workCategory),
				},
				(coordination) =>
					closeClockOut(coordination, {
						plan,
						replayable: isReplayable(command.identity),
						target,
						eventInstant,
						capture,
					}),
			);
		} catch (error) {
			return refused(closureRefusal(error));
		}
		if (closure.disposition === "replayed") {
			return {
				outcome: "replayed",
				result: closure.result,
				durationMinutes: closure.durationMinutes,
			};
		}
		// Committed: follow-ups are best-effort and never turn this into a failure.
		const advice = await followUps
			.afterClockOut({ ...closure.closed, timezone: command.zone.fallback })
			.catch(() => ({}));
		return {
			outcome: "executed",
			result: { ...closure.entry, pendingApproval: undefined, ...advice },
			durationMinutes: closure.closed.durationMinutes,
		};
	}

	return {
		async run(command) {
			if (!CANONICAL_UUID.test(command.identity.id)) {
				return refused({ code: "invalid_command" });
			}
			const subject = await subjectEmployee(command);
			if (!subject) return refused({ code: "access_denied" });
			const billing = await requireBillingForMutation(command.organizationId);
			if (!isBillingMutationAllowed(billing)) {
				return refused({
					code: "billing_required",
					reason: billing.reason ?? "subscription_required",
				});
			}
			const plan = planClockOut(command, subject);
			const replayable = isReplayable(command.identity);
			if (replayable) {
				const replay = await committedReplay(plan);
				if (replay) return replay;
			}
			const eventInstant = command.at.kind === "occurred" ? command.at.instant : clock.nowInstant();
			const outcome = await execute(plan, eventInstant);
			if (replayable && outcome.outcome === "refused" && LATE_REFUSALS.has(outcome.failure.code)) {
				// A matching command may have committed since the first replay read.
				const replay = await committedReplay(plan);
				if (replay?.outcome === "replayed") return replay;
			}
			return outcome;
		},

		async lookup(query) {
			const subject = await subjectEmployee(query);
			if (!subject) return { found: false };
			const [receipt] = await db
				.select({ kind: completedWorkOperation.kind, result: completedWorkOperation.result })
				.from(completedWorkOperation)
				.where(
					and(
						eq(completedWorkOperation.id, query.identity.id),
						eq(completedWorkOperation.organizationId, subject.organizationId),
						eq(completedWorkOperation.employeeId, subject.id),
						eq(completedWorkOperation.kind, "close_active_work"),
					),
				)
				.limit(1);
			return receipt
				? {
						found: true,
						kind: "close_active_work",
						result: receipt.result as CloseActiveWorkResult,
					}
				: { found: false };
		},
	};
}
