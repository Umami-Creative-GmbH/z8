import "server-only";

// The clock-out follow-up effects (#524). The Clocking module decides when they
// run; they take every subject explicitly, never from a request session, so bot,
// API and worker closures run them like web ones. Callers authorize the employee.

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { project } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import {
	type BreakEnforcementResult,
	BreakEnforcementService,
	BreakEnforcementServiceLive,
} from "@/lib/effect/services/break-enforcement.service";
import { SurchargeService, SurchargeServiceLive } from "@/lib/effect/services/surcharge.service";
import {
	type ComplianceWarning,
	WorkPolicyService,
} from "@/lib/effect/services/work-policy.service";
import { createLogger } from "@/lib/logger";
import { recordJarbschgViolationsAfterClockOut } from "@/lib/statutory/youth/clock-out";
import {
	checkProjectBudgetWarnings,
	getProjectTotalHours,
} from "@/lib/notifications/project-notification-triggers";
import { readComplianceTotals } from "./compliance-totals";
import type { PolicyClockOutSurchargeSnapshot } from "./policy-clock-out-surcharge-snapshot";

const logger = createLogger("TimeTracking:ClockOutEffects");

/** One closed stretch of work: its exact endpoints and its rounded duration. */
export type ClosedWork = {
	/** Where the work started; its local day and week are checked, its violations dated here. */
	start: Instant;
	/** Where the work ended exactly; the policy in force here judges it. */
	end: Instant;
	durationMinutes: number;
};

type ClockOutComplianceInput = {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	work: ClosedWork;
	timezone: string;
};

/**
 * Checks one closed period against the employee's working-time rules and logs
 * its violations. Totals come from `readComplianceTotals`, never from the
 * request session, and cover the work's own local day and week in `timezone`,
 * so on-behalf, bot, API and worker closures are judged like self clock-outs.
 *
 * The work is judged by the policy assigned as of its end, the instant the
 * policy clock-out break snapshot also reads (ADR 0003), and each violation is
 * dated at the work's start: the day and week whose totals broke the rule
 * (#548). When the check runs does not matter.
 */
export async function checkComplianceAfterClockOut(
	input: ClockOutComplianceInput,
	options: {
		throwOnError?: boolean;
		/** False when the caller runs `recordYouthProtectionAfterClockOut` as its own step. */
		youthProtection?: boolean;
	} = {},
): Promise<ComplianceWarning[]> {
	const { employeeId, organizationId, workPeriodId, work } = input;
	let warnings: ComplianceWarning[] = [];
	try {
		const totals = await readComplianceTotals({
			organizationId,
			employeeId,
			workStart: work.start,
			timezone: input.timezone,
		});

		const complianceEffect = Effect.gen(function* () {
			const workPolicyService = yield* WorkPolicyService;
			const result = yield* workPolicyService.checkCompliance({
				employeeId,
				organizationId,
				policyAt: work.end,
				currentSessionMinutes: work.durationMinutes,
				totalDailyMinutes: totals.dailyMinutes,
				totalWeeklyMinutes: totals.weeklyMinutes,
				breaksTakenMinutes: totals.breakMinutes,
			});

			const { policyId, policyVersionId } = result;
			if (policyId) {
				for (const warning of result.warnings) {
					if (warning.severity === "violation") {
						yield* workPolicyService.logViolation({
							employeeId,
							organizationId,
							policyId,
							policyVersionId,
							workPeriodId,
							violationAt: work.start,
							violationType: warning.type,
							details: {
								actualMinutes: warning.actualValue,
								limitMinutes: warning.limitValue,
								warningShownAt: new Date().toISOString(),
								userContinued: true,
							},
						});
					}
				}
			}

			return result.warnings;
		});

		warnings = await runtime.runPromise(complianceEffect);
	} catch (error) {
		if (options.throwOnError) throw error;
		logger.error({ error }, "Failed to check compliance after clock-out");
	}
	if (options.youthProtection !== false) await recordYouthProtectionAfterClockOut(input, options);
	return warnings;
}

/**
 * JArbSchG youth limits (#1993) apply to every employee under 18 on the work's day, whatever
 * their work policy or ArbZG scope, so they are checked beside the policy rules. Records each
 * rule once per day, so a retry is safe.
 */
export async function recordYouthProtectionAfterClockOut(
	input: ClockOutComplianceInput,
	options: { throwOnError?: boolean } = {},
): Promise<void> {
	try {
		await recordJarbschgViolationsAfterClockOut(db, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			workPeriodId: input.workPeriodId,
			workStart: input.work.start,
			timezone: input.timezone,
		});
	} catch (error) {
		if (options.throwOnError) throw error;
		logger.error({ error }, "Failed to check youth protection after clock-out");
	}
}

/**
 * The compliance steps of a durable automatic clock-out follow-up. Each throws so the outbox
 * retries it, and each is its own progress step: the policy check logs its violations without
 * dedupe, so a failing youth check must not make it run again.
 */
export const automaticClockOutComplianceEffects = {
	checkCompliance: (input: ClockOutComplianceInput) =>
		checkComplianceAfterClockOut(input, { throwOnError: true, youthProtection: false }),
	recordYouthProtection: (input: ClockOutComplianceInput) =>
		recordYouthProtectionAfterClockOut(input, { throwOnError: true }),
};

export async function reconcileImmediateSurcharges(input: {
	organizationId: string;
	employeeId: string;
	affectedWorkPeriodIds: string[];
	snapshot: PolicyClockOutSurchargeSnapshot;
}): Promise<void> {
	const surchargeEffect = Effect.gen(function* () {
		const surchargeService = yield* SurchargeService;
		yield* surchargeService.reconcileWorkPeriods({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			surchargePeriodIds: input.affectedWorkPeriodIds,
			staleSurchargePeriodIds: [],
			surchargeSnapshot: input.snapshot,
		});
	});

	await runtime.runPromise(surchargeEffect.pipe(Effect.provide(SurchargeServiceLive)));
}

export async function enforceBreaksAfterClockOut(input: {
	employeeId: string;
	organizationId: string;
	workPeriodId: string;
	createdBy: string;
}): Promise<BreakEnforcementResult> {
	// Failures propagate: the after-commit follow-ups run this best-effort, and a
	// departure's durable follow-up task retries it (#485).
	const enforcementEffect = Effect.gen(function* () {
		const breakService = yield* BreakEnforcementService;
		return yield* breakService.enforceBreaksAfterClockOut(input);
	});

	return runtime.runPromise(enforcementEffect.pipe(Effect.provide(BreakEnforcementServiceLive)));
}

export async function checkProjectBudgetAfterClockOut(
	projectId: string,
	organizationId: string,
	options: { throwOnError?: boolean } = {},
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

	await checkProjectBudgetWarnings(
		{
			projectId,
			projectName: assignedProject.name,
			organizationId,
			budgetHours,
			usedHours: totalHours,
		},
		options,
	);
}
