import type { DismissiblePayrollBlockerType, PayrollBlocker, PayrollBlockerType } from "./types";

export type DismissiblePayrollBlocker = PayrollBlocker & { type: DismissiblePayrollBlockerType };

export function isDismissiblePayrollBlockerType(
	blockerType: PayrollBlockerType,
): blockerType is DismissiblePayrollBlockerType {
	return blockerType !== "unresolved_work_minutes";
}

export function isDismissiblePayrollBlocker(
	blocker: PayrollBlocker,
): blocker is DismissiblePayrollBlocker {
	return isDismissiblePayrollBlockerType(blocker.type);
}

export interface PayrollBlockerDismissalKey {
	blockerType: DismissiblePayrollBlockerType;
	sourceId: string;
}

export function filterDismissedPayrollBlockers(
	blockers: PayrollBlocker[],
	dismissals: PayrollBlockerDismissalKey[],
): PayrollBlocker[] {
	if (dismissals.length === 0) return blockers;

	const dismissedSourceIdsByType = new Map<DismissiblePayrollBlockerType, Set<string>>();
	for (const dismissal of dismissals) {
		const sourceIds =
			dismissedSourceIdsByType.get(dismissal.blockerType) ?? new Set();
		sourceIds.add(dismissal.sourceId);
		dismissedSourceIdsByType.set(dismissal.blockerType, sourceIds);
	}

	return blockers.filter(
		(blocker) =>
			!(
				isDismissiblePayrollBlocker(blocker) &&
				dismissedSourceIdsByType.get(blocker.type)?.has(blocker.id)
			),
	);
}
