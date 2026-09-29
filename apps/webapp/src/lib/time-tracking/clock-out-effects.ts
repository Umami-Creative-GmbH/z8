import "server-only";

// The clock-out follow-up effects (#524). The Clocking module decides when they
// run; they take every subject explicitly, never from a request session, so bot,
// API and worker closures run them like web ones. Callers authorize the employee.

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { project } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type BreakEnforcementResult,
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { SurchargeService, SurchargeServiceLive } from "@/lib/effect/services/surcharge.service";
import {
	type ComplianceWarning,
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import { createLogger } from "@/lib/logger";
import {
	checkProjectBudgetWarnings,
	getProjectTotalHours,
} from "@/lib/notifications/project-notification-triggers";
import { readComplianceTotals } from "./compliance-totals";
import type { PolicyClockOutSurchargeSnapshot } from "./policy-clock-out-surcharge-snapshot";

const logger = createLogger("TimeTracking:ClockOutEffects");

/**
 * Checks one closed period against the employee's working-time rules and logs
 * its violations. Totals come from `readComplianceTotals`, never from the
 * request session, and cover the work's own local day and week in `timezone`,
 * so on-behalf, bot, API and worker closures are judged like self clock-outs.
 *
 * The work is judged by the policy in force when it ended, as the policy
 * clock-out break snapshot captures it (ADR 0003), and each violation is dated
 * at the work's start: the day and week whose totals broke the rule (#548).
 * When the check runs does not matter.
 */
export async function checkComplianceAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	durationMinutes: number;
	/** Where the closed work started; its violations are dated here. */
	workStart: Instant;
	/** Where the closed work ended; the policy in force here judges it. */
	workEnd: Instant;
	timezone: string;
}): Promise<ComplianceWarning[]> {
	const { employeeId, organizationId, workPeriodId } = input;
	try {
		const totals = await readComplianceTotals({
			organizationId,
			employeeId,
			workStart: input.workStart,
			timezone: input.timezone,
		});

		const complianceEffect = Effect.gen(function* (_) {
			const workPolicyService = yield* _(WorkPolicyService);
			const result = yield* _(
				workPolicyService.checkCompliance({
					employeeId,
					organizationId,
					policyAt: input.workEnd,
					currentSessionMinutes: input.durationMinutes,
					totalDailyMinutes: totals.dailyMinutes,
					totalWeeklyMinutes: totals.weeklyMinutes,
					breaksTakenMinutes: totals.breakMinutes,
				}),
			);

			const { policyId } = result;
			if (policyId) {
				for (const warning of result.warnings) {
					if (warning.severity === "violation") {
						yield* _(
							workPolicyService.logViolation({
								employeeId,
								organizationId,
								policyId,
								workPeriodId,
								violationDate: input.workStart,
								violationType: warning.type,
								details: {
									actualMinutes: warning.actualValue,
									limitMinutes: warning.limitValue,
									warningShownAt: new Date().toISOString(),
									userContinued: true,
								},
							}),
						);
					}
				}
			}

			return result.warnings;
		}).pipe(Effect.provide(WorkPolicyServiceLive), Effect.provide(DatabaseServiceLive));

		return await Effect.runPromise(complianceEffect);
	} catch (error) {
		logger.error({ error }, "Failed to check compliance after clock-out");
		return [];
	}
}

export async function reconcileImmediateSurcharges(input: {
	organizationId: string;
	employeeId: string;
	affectedWorkPeriodIds: string[];
	snapshot: PolicyClockOutSurchargeSnapshot;
}): Promise<void> {
	const surchargeEffect = Effect.gen(function* (_) {
		const surchargeService = yield* _(SurchargeService);
		yield* _(
			surchargeService.reconcileWorkPeriods({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				surchargePeriodIds: input.affectedWorkPeriodIds,
				staleSurchargePeriodIds: [],
				surchargeSnapshot: input.snapshot,
			}),
		);
	}).pipe(Effect.provide(SurchargeServiceLive), Effect.provide(DatabaseServiceLive));

	await Effect.runPromise(surchargeEffect);
}

export async function enforceBreaksAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	sessionDurationMinutes: number;
	timezone: string;
	createdBy: string;
}): Promise<BreakEnforcementResult> {
	// Failures propagate: the after-commit follow-ups run this best-effort, and a
	// departure's durable follow-up task retries it (#485).
	const enforcementEffect = Effect.gen(function* (_) {
		const breakService = yield* _(BreakEnforcementService);
		return yield* _(breakService.enforceBreaksAfterClockOut(input));
	}).pipe(
		Effect.provide(BreakEnforcementServiceLive),
		Effect.provide(WorkPolicyServiceLive),
		Effect.provide(DatabaseServiceLive),
	);

	return Effect.runPromise(enforcementEffect);
}

export async function checkProjectBudgetAfterClockOut(
	projectId: string,
	organizationId: string,
): Promise<void> {
	const assignedProject = await db.query.project.findFirst({
		where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
		columns: {
			id: true,
			name: true,
			budgetHours: true,
		},
	});

	if (!assignedProject?.budgetHours) {
		return;
	}

	const budgetHours = Number.parseFloat(assignedProject.budgetHours);
	if (Number.isNaN(budgetHours) || budgetHours <= 0) {
		return;
	}

	const totalHours = await getProjectTotalHours(projectId, organizationId);

	await checkProjectBudgetWarnings({
		projectId,
		projectName: assignedProject.name,
		organizationId,
		budgetHours,
		usedHours: totalHours,
	});
}
