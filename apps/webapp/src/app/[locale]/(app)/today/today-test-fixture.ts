import type { ManagerDailyBriefing } from "@/lib/manager-daily-briefing/types";
export function briefingFixture(): ManagerDailyBriefing {
	const section = (id: string, title: string) => ({
		id,
		title,
		description: `${title} context`,
		items: [],
	});
	return {
		date: "2026-11-16",
		generatedAt: "2026-11-16T09:20:00Z",
		summary: {
			criticalIssues: 0,
			openApprovals: 0,
			attendanceExceptions: 0,
			absencesToday: 0,
			payrollIssues: 0,
			coverageRisks: 0,
			overtimeWarnings: 0,
		},
		needsAction: [],
		sections: {
			approvals: section("approvals", "Approvals"),
			attendance: section("attendance", "Attendance"),
			absences: section("absences", "Absences"),
			coverage: section("coverage", "Coverage"),
			overtime: section("overtime", "Overtime"),
			payroll: section("payroll", "Payroll"),
		},
	};
}
