import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { BreakEnforcementResult } from "@/lib/effect/services/break-enforcement.service";
import type { ComplianceWarning } from "@/lib/effect/services/work-policy.service";
import { createLogger } from "@/lib/logger";
import type { PolicyClockOutSurchargeSnapshot } from "../policy-clock-out-surcharge-snapshot";
import type { ClockOutResult } from "./types";

const logger = createLogger("Clocking:FollowUps");

/** The committed facts of one executed live closure that its follow-ups need. */
export type ClosedLiveWork = {
	organizationId: string;
	employeeId: string;
	/** The human who completed the work. */
	actorUserId: string;
	workPeriodId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	/** The closed period's project, whatever the command's attribution intent. */
	projectId: string | null;
	surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	/** True when the closure committed its own work-balance refresh intent. */
	balanceRefreshCommitted: boolean;
	/** The zone the command was evaluated in, for day-bounded rules. */
	timezone: string;
};

/** What the follow-ups tell the employee about a closure they ran after. */
export type ClockOutAdvice = Pick<ClockOutResult, "complianceWarnings" | "breakAdjustment">;

/**
 * The follow-ups port: what runs once per executed closure, never on replay.
 * `afterCommitFollowUps` runs them best-effort after commit; `recordingFollowUps`
 * records them for tests.
 */
export interface ClockFollowUps {
	afterClockOut(closure: ClosedLiveWork): Promise<ClockOutAdvice>;
}

/** The effect implementations the after-commit adapter sequences. */
export type ClockOutFollowUpEffects = {
	checkCompliance(input: {
		employeeId: string;
		organizationId: string;
		workPeriodId: string;
		durationMinutes: number;
		timezone: string;
	}): Promise<ComplianceWarning[]>;
	enforceBreaks(input: {
		employeeId: string;
		organizationId: string;
		workPeriodId: string;
		sessionDurationMinutes: number;
		timezone: string;
		createdBy: string;
	}): Promise<BreakEnforcementResult>;
	reconcileSurcharges(input: {
		organizationId: string;
		employeeId: string;
		affectedWorkPeriodIds: string[];
		snapshot: PolicyClockOutSurchargeSnapshot;
	}): Promise<void>;
	markBalanceDirty(input: {
		employeeId: string;
		organizationId: string;
		dirtyFromDate: string;
	}): Promise<void>;
	checkProjectBudget(projectId: string, organizationId: string): Promise<void>;
};

async function bestEffort<T>(
	operation: () => Promise<T>,
	fallback: T,
	message: string,
	context: Record<string, unknown>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		logger.error({ error, ...context }, message);
		return fallback;
	}
}

/**
 * Compliance, break enforcement, surcharges, the balance-dirty mark and budget
 * warnings, in that order and each best-effort: none of them can turn the
 * committed closure into a failure.
 */
export function afterCommitFollowUps(effects: ClockOutFollowUpEffects): ClockFollowUps {
	return {
		async afterClockOut(closure) {
			const { employeeId, organizationId, workPeriodId } = closure;
			const context = { organizationId, workPeriodId };
			const complianceWarnings = await bestEffort(
				() =>
					effects.checkCompliance({
						employeeId,
						organizationId,
						workPeriodId,
						durationMinutes: closure.durationMinutes,
						timezone: closure.timezone,
					}),
				[],
				"Failed to check compliance after clock-out",
				context,
			);
			const breakEnforcement = await bestEffort<BreakEnforcementResult>(
				() =>
					effects.enforceBreaks({
						employeeId,
						organizationId,
						workPeriodId,
						sessionDurationMinutes: closure.durationMinutes,
						timezone: closure.timezone,
						createdBy: closure.actorUserId,
					}),
				{ wasAdjusted: false, affectedWorkPeriodIds: [workPeriodId] },
				"Failed to enforce breaks after clock-out",
				context,
			);
			const { surchargeSnapshot } = closure;
			if (surchargeSnapshot) {
				await bestEffort(
					() =>
						effects.reconcileSurcharges({
							affectedWorkPeriodIds: breakEnforcement.affectedWorkPeriodIds,
							employeeId,
							organizationId,
							snapshot: surchargeSnapshot,
						}),
					undefined,
					"Failed to calculate surcharges after clock-out",
					context,
				);
			}
			// The operation commits this refresh intent with the work itself.
			if (!closure.balanceRefreshCommitted) {
				await bestEffort(
					() =>
						effects.markBalanceDirty({
							employeeId,
							organizationId,
							dirtyFromDate: instantFromDate(closure.startTime)
								.toZonedDateTimeISO("UTC")
								.toPlainDate()
								.toString(),
						}),
					undefined,
					"Failed to mark work balance dirty after clock-out",
					{ ...context, employeeId },
				);
			}
			const { projectId } = closure;
			if (projectId) {
				void effects.checkProjectBudget(projectId, organizationId).catch((error) => {
					logger.error({ error, projectId }, "Failed to check project budget warnings");
				});
			}
			return {
				complianceWarnings: complianceWarnings.length > 0 ? complianceWarnings : undefined,
				breakAdjustment: breakEnforcement.wasAdjusted ? breakEnforcement.adjustment : undefined,
			};
		},
	};
}

/** Records every closure it is asked to follow up, for tests. */
export function recordingFollowUps(): ClockFollowUps & { readonly closures: ClosedLiveWork[] } {
	const closures: ClosedLiveWork[] = [];
	return {
		closures,
		async afterClockOut(closure) {
			closures.push(closure);
			return {};
		},
	};
}
