export type ManagerTodayBriefingSummary = {
	criticalIssues: number;
	openApprovals: number;
	/**
	 * `openApprovals` is a lower bound (#1980). The dashboard reads counts only, so only a failed
	 * count can set it here; a type whose list failed but whose count succeeded is counted
	 * exactly. `/today` reads the list too, and there a failed list can hide a failed count, so it
	 * reads every failure as a lower bound: the two can differ for a list-only failure.
	 */
	openApprovalsAtLeast?: true;
	/** The approvals could not be read at all: shown as unavailable, not "0+". */
	openApprovalsUnavailable?: true;
	attendanceExceptions: number;
	absencesToday: number;
	coverageRisks: number;
	overtimeWarnings: number;
	payrollIssues: number;
};

export type ManagerTodayMetricCounts = {
	critical: number;
	approvals: number;
	/** `approvals` is a lower bound, shown as "N+" as `/today` shows it. */
	approvalsAtLeast?: true;
	/** No approvals count is known at all; shown as unavailable, as `/today` shows it. */
	approvalsUnavailable?: true;
	clockIns: number;
	risks: number;
	allClear: boolean;
};

export function mapManagerTodaySummary(
	summary: ManagerTodayBriefingSummary,
): ManagerTodayMetricCounts {
	const counts = {
		critical: summary.criticalIssues,
		approvals: summary.openApprovals,
		clockIns: summary.attendanceExceptions,
		risks: summary.coverageRisks + summary.overtimeWarnings + summary.payrollIssues,
	};

	return {
		...counts,
		...(summary.openApprovalsAtLeast ? { approvalsAtLeast: true as const } : {}),
		...(summary.openApprovalsUnavailable ? { approvalsUnavailable: true as const } : {}),
		// Approvals that failed to load may still wait: never all clear on a lower bound.
		allClear: !summary.openApprovalsAtLeast && Object.values(counts).every((count) => count === 0),
	};
}
