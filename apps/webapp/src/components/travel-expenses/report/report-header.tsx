"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";
import { type ReportNameSource, reportKindLabel, reportName } from "../report-name";
import { ReportStatusBadge } from "./report-status";

/**
 * The one header of every expense report view (#688): the kind line, the
 * report's name as the page heading and its only status badge. `actions`
 * (such as deleting a draft) sit at the end of the header row.
 */
export function ReportHeader({
	source,
	status,
	actions,
}: {
	source: ReportNameSource;
	status: TravelExpenseReportStatus;
	actions?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<header className="flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0 space-y-1">
				<p className="text-sm font-medium text-muted-foreground">{reportKindLabel(t, source)}</p>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
						{reportName(t, source)}
					</h1>
					<ReportStatusBadge status={status} />
				</div>
			</div>
			{actions}
		</header>
	);
}
