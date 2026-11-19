"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";

export type ReportBadgeStatus = TravelExpenseReportStatus | "withdrawn" | "reopened";

/** Review status of an expense report or a frozen submission. */
export function ReportStatusBadge({ status }: { status: ReportBadgeStatus }) {
	const { t } = useTranslate();
	switch (status) {
		case "draft":
			return <Badge variant="secondary">{t("travelExpenses.status.draft", "Draft")}</Badge>;
		case "submitted":
			return (
				<Badge variant="outline">
					{t("travelExpenses.report.status.submitted", "Awaiting review")}
				</Badge>
			);
		case "approved":
			return <Badge>{t("travelExpenses.report.status.approved", "Approved")}</Badge>;
		case "rejected":
			return (
				<Badge variant="destructive">
					{t("travelExpenses.report.status.rejected", "Rejected")}
				</Badge>
			);
		case "withdrawn":
			return (
				<Badge variant="secondary">
					{t("travelExpenses.report.history.step.withdrawn", "Withdrawn")}
				</Badge>
			);
		case "reopened":
			return (
				<Badge variant="outline">
					{t("travelExpenses.report.history.step.reopened", "Reopened for correction")}
				</Badge>
			);
		case "returned":
			return (
				<Badge
					variant="outline"
					className="border-amber-500/60 text-amber-700 dark:border-amber-400/60 dark:text-amber-300"
				>
					{t("travelExpenses.report.status.returned", "Returned for changes")}
				</Badge>
			);
	}
}
