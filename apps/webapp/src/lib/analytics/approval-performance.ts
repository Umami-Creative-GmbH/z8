import { DateTime } from "luxon";

import type { ApprovalBottleneckRow, ManagerEffectivenessData } from "./types";

export type ApprovalAnalyticsStatus = "approved" | "rejected" | "pending" | "draft";

export type ApprovalAnalyticsSource = "approval_request" | "travel_expense_claim";

export type ApprovalAnalyticsSlaStatus = "on_time" | "approaching" | "overdue" | null;

export type ApprovalAnalyticsRow = {
	source: ApprovalAnalyticsSource;
	type: string;
	organizationId: string;
	requesterEmployeeId: string;
	requesterTeamId: string | null;
	requesterTeamName: string | null;
	approverEmployeeId: string | null;
	approverName: string | null;
	status: ApprovalAnalyticsStatus;
	submittedAt: Date;
	decidedAt: Date | null;
	slaStatus: ApprovalAnalyticsSlaStatus;
};

type ApprovalMetricSummary = ManagerEffectivenessData["approvalMetrics"];

type ApprovalManagerRow = ManagerEffectivenessData["byManager"][number];

export type ApprovalPerformanceData = Omit<
	ManagerEffectivenessData,
	"approvalMetrics" | "byManager"
> & {
	approvalMetrics: ApprovalMetricSummary;
	byManager: ApprovalManagerRow[];
	byTeam: ApprovalBottleneckRow[];
	byType: ApprovalBottleneckRow[];
};

type GroupAccumulator = {
	label: string;
	approvals: number;
	rejections: number;
	pending: number;
	pendingSlaWarnings: number;
	decisionTimeHours: number[];
};

const RESPONSE_TIME_BUCKETS = ["< 1 day", "1-3 days", "3-7 days", "> 7 days"] as const;

export function buildApprovalPerformanceData(
	inputRows: ApprovalAnalyticsRow[],
): ApprovalPerformanceData {
	const rows = inputRows.filter((row) => row.status !== "draft");
	const approvedRows = rows.filter((row) => row.status === "approved");
	const rejectedRows = rows.filter((row) => row.status === "rejected");
	const decisionTimeHours = rows.flatMap((row) => decisionTimeHoursFor(row));
	const pendingSlaWarnings = rows.filter(isPendingSlaWarning).length;
	const decidedCount = approvedRows.length + rejectedRows.length;
	const avgDecisionTimeHours = average(decisionTimeHours);

	return {
		approvalMetrics: {
			avgResponseTime: round(avgDecisionTimeHours / 24),
			avgDecisionTimeHours: round(avgDecisionTimeHours),
			totalApprovals: approvedRows.length,
			totalRejections: rejectedRows.length,
			approvalRate: decidedCount > 0 ? round((approvedRows.length / decidedCount) * 100) : 0,
			pendingSlaWarnings,
		},
		byManager: buildGroupedRows(rows, (row) => ({
			id: row.approverEmployeeId ?? "unassigned",
			label: row.approverName ?? "Unassigned",
		})).map((row) => ({
			managerId: row.id,
			managerName: row.label,
			avgResponseTime: round(row.avgDecisionTimeHours / 24),
			avgDecisionTimeHours: row.avgDecisionTimeHours,
			totalApprovals: row.approvedCount,
			totalRejections: row.rejectedCount,
			approvalRate: row.approvalRate,
			teamSize: 0,
			pendingCount: row.pendingCount,
			pendingSlaWarnings: row.pendingSlaWarnings,
		})),
		byTeam: buildGroupedRows(rows, (row) => ({
			id: row.requesterTeamId ?? "unassigned",
			label: row.requesterTeamName ?? "Unassigned",
		})),
		byType: buildGroupedRows(rows, (row) => ({
			id: row.type,
			label: labelForType(row.type),
		})),
		responseTimeDistribution: buildResponseTimeDistribution(decisionTimeHours),
		trends: buildMonthlyTrends(rows),
	};
}

function buildGroupedRows(
	rows: ApprovalAnalyticsRow[],
	selectGroup: (row: ApprovalAnalyticsRow) => { id: string; label: string },
): ApprovalBottleneckRow[] {
	const groups = new Map<string, GroupAccumulator>();

	for (const row of rows) {
		const group = selectGroup(row);
		const current = groups.get(group.id) ?? {
			label: group.label,
			approvals: 0,
			rejections: 0,
			pending: 0,
			pendingSlaWarnings: 0,
			decisionTimeHours: [] as number[],
		};

		if (row.status === "approved") current.approvals++;
		if (row.status === "rejected") current.rejections++;
		if (row.status === "pending") current.pending++;
		if (isPendingSlaWarning(row)) current.pendingSlaWarnings++;

		current.decisionTimeHours.push(...decisionTimeHoursFor(row));
		groups.set(group.id, current);
	}

	return Array.from(groups.entries())
		.map(([id, group]) => {
			const decidedCount = group.approvals + group.rejections;
			const avgDecisionTimeHours = average(group.decisionTimeHours);

			return {
				id,
				label: group.label,
				approvedCount: group.approvals,
				rejectedCount: group.rejections,
				pendingCount: group.pending,
				pendingSlaWarnings: group.pendingSlaWarnings,
				avgDecisionTimeHours: round(avgDecisionTimeHours),
				approvalRate: decidedCount > 0 ? round((group.approvals / decidedCount) * 100) : 0,
			};
		})
		.sort((a, b) => {
			const slaDelta = b.pendingSlaWarnings - a.pendingSlaWarnings;
			if (slaDelta !== 0) return slaDelta;

			const pendingDelta = b.pendingCount - a.pendingCount;
			if (pendingDelta !== 0) return pendingDelta;

			return b.avgDecisionTimeHours - a.avgDecisionTimeHours;
		});
}

function buildResponseTimeDistribution(
	decisionTimeHours: number[],
): ApprovalPerformanceData["responseTimeDistribution"] {
	const bucketCounts = new Map<(typeof RESPONSE_TIME_BUCKETS)[number], number>(
		RESPONSE_TIME_BUCKETS.map((bucket) => [bucket, 0]),
	);

	for (const hours of decisionTimeHours) {
		const days = hours / 24;
		if (days < 1) {
			bucketCounts.set("< 1 day", (bucketCounts.get("< 1 day") ?? 0) + 1);
		} else if (days <= 3) {
			bucketCounts.set("1-3 days", (bucketCounts.get("1-3 days") ?? 0) + 1);
		} else if (days <= 7) {
			bucketCounts.set("3-7 days", (bucketCounts.get("3-7 days") ?? 0) + 1);
		} else {
			bucketCounts.set("> 7 days", (bucketCounts.get("> 7 days") ?? 0) + 1);
		}
	}

	return RESPONSE_TIME_BUCKETS.map((bucket) => {
		const count = bucketCounts.get(bucket) ?? 0;

		return {
			bucket,
			count,
			percentage:
				decisionTimeHours.length > 0 ? Math.round((count / decisionTimeHours.length) * 100) : 0,
		};
	});
}

function buildMonthlyTrends(rows: ApprovalAnalyticsRow[]): ApprovalPerformanceData["trends"] {
	const monthly = new Map<
		string,
		{ approvals: number; rejections: number; totalDecisionTimeHours: number; decidedCount: number }
	>();

	for (const row of rows) {
		const month = DateTime.fromJSDate(row.submittedAt).toFormat("yyyy-MM");
		const current = monthly.get(month) ?? {
			approvals: 0,
			rejections: 0,
			totalDecisionTimeHours: 0,
			decidedCount: 0,
		};

		if (row.status === "approved") current.approvals++;
		if (row.status === "rejected") current.rejections++;

		for (const hours of decisionTimeHoursFor(row)) {
			current.totalDecisionTimeHours += hours;
			current.decidedCount++;
		}

		monthly.set(month, current);
	}

	return Array.from(monthly.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([month, data]) => ({
			month,
			approvals: data.approvals,
			rejections: data.rejections,
			avgResponseTime:
				data.decidedCount > 0 ? round(data.totalDecisionTimeHours / data.decidedCount / 24) : 0,
			avgDecisionTimeHours:
				data.decidedCount > 0 ? round(data.totalDecisionTimeHours / data.decidedCount) : 0,
		}));
}

function decisionTimeHoursFor(row: ApprovalAnalyticsRow): number[] {
	if (!row.decidedAt) {
		return [];
	}

	return [row.decidedAt.getTime() - row.submittedAt.getTime()].map(
		(milliseconds) => milliseconds / 3_600_000,
	);
}

function isPendingSlaWarning(row: ApprovalAnalyticsRow): boolean {
	return (
		row.status === "pending" && (row.slaStatus === "approaching" || row.slaStatus === "overdue")
	);
}

function average(values: number[]): number {
	return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function labelForType(type: string): string {
	return type
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
