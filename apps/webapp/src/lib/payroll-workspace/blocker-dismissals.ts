import type { PayrollBlocker, PayrollBlockerType } from "./types";

export interface PayrollBlockerDismissalKey {
	blockerType: PayrollBlockerType;
	sourceId: string;
}

export function filterDismissedPayrollBlockers(
	blockers: PayrollBlocker[],
	dismissals: PayrollBlockerDismissalKey[],
): PayrollBlocker[] {
	if (dismissals.length === 0) return blockers;

	const dismissedSourceIdsByType = new Map<PayrollBlockerType, Set<string>>();
	for (const dismissal of dismissals) {
		const sourceIds =
			dismissedSourceIdsByType.get(dismissal.blockerType) ?? new Set();
		sourceIds.add(dismissal.sourceId);
		dismissedSourceIdsByType.set(dismissal.blockerType, sourceIds);
	}

	return blockers.filter(
		(blocker) => !dismissedSourceIdsByType.get(blocker.type)?.has(blocker.id),
	);
}
