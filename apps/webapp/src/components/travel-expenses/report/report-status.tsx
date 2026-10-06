"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";

/** Review status of an expense report (#602). */
export function ReportStatusBadge({ status }: { status: TravelExpenseReportStatus }) {
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
	}
}
