export type ManagerTodayBriefingSummary = {
	criticalIssues: number;
	openApprovals: number;
	/** `openApprovals` is a lower bound: an approval type failed to load or count (#1980). */
	openApprovalsAtLeast?: true;
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
		// Approvals that failed to load may still wait: never all clear on a lower bound.
		allClear: !summary.openApprovalsAtLeast && Object.values(counts).every((count) => count === 0),
	};
}
