export type ManagerTodayBriefingSummary = {
	criticalIssues: number;
	openApprovals: number;
	attendanceExceptions: number;
	absencesToday: number;
	coverageRisks: number;
	overtimeWarnings: number;
	payrollIssues: number;
};

export type ManagerTodayMetricCounts = {
	critical: number;
	approvals: number;
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
		allClear: Object.values(counts).every((count) => count === 0),
	};
}
