import type { ClockOutFollowUpEffects, ClosedLiveWork } from "../clocking/follow-ups";

export type AutoClockOutTaskContext = {
	recordProgress(patch: Record<string, unknown>): Promise<void>;
};

/** Resume the existing effect owners with frozen closure facts. Break reconciliation owns its committed intent and idempotence. */
export async function runAutoClockOutFollowUps(
	closure: ClosedLiveWork,
	progress: Record<string, unknown>,
	context: AutoClockOutTaskContext,
	effects: ClockOutFollowUpEffects,
): Promise<void> {
	const { organizationId, employeeId, workPeriodId, timezone } = closure;
	const scope = { organizationId, employeeId };
	if (progress.complianceChecked !== true) {
		await effects.checkCompliance({ ...scope, workPeriodId, timezone, work: closure });
		await context.recordProgress({ complianceChecked: true });
	}
	let affectedWorkPeriodIds = [workPeriodId];
	if (progress.breaksEnforced === true) {
		if (
			!Array.isArray(progress.affectedWorkPeriodIds) ||
			!progress.affectedWorkPeriodIds.every((id) => typeof id === "string")
		)
			throw new Error("invalid_follow_up_progress");
		affectedWorkPeriodIds = progress.affectedWorkPeriodIds;
	} else {
		const result = await effects.enforceBreaks({
			...scope,
			workPeriodId,
			timezone,
			durationMinutes: closure.durationMinutes,
			createdBy: closure.actorUserId,
		});
		affectedWorkPeriodIds = result.affectedWorkPeriodIds;
		await context.recordProgress({ breaksEnforced: true, affectedWorkPeriodIds });
	}
	if (closure.surchargeSnapshot && progress.surchargesReconciled !== true) {
		await effects.reconcileSurcharges({
			...scope,
			affectedWorkPeriodIds,
			snapshot: closure.surchargeSnapshot,
		});
		await context.recordProgress({ surchargesReconciled: true });
	}
	if (!closure.balanceRefreshCommitted && progress.balanceMarked !== true) {
		await effects.markBalanceDirty({
			...scope,
			dirtyFromDate: closure.start.toZonedDateTimeISO("UTC").toPlainDate().toString(),
		});
		await context.recordProgress({ balanceMarked: true });
	}
	if (closure.projectId && progress.projectChecked !== true) {
		await effects.checkProjectBudget(closure.projectId, organizationId);
		await context.recordProgress({ projectChecked: true });
	}
}
