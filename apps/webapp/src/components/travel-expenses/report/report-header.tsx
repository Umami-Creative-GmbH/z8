"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { type ReportNameSource, reportKindLabel, reportName } from "../report-name";
import { type ReportBadgeStatus, ReportStatusBadge } from "./report-status";

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
	status?: ReportBadgeStatus;
	actions?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<header>
			<PageHeader
				title={reportName(t, source)}
				scope={
					<span className="flex flex-wrap items-center gap-3">
						{reportKindLabel(t, source)}
						{status && <ReportStatusBadge status={status} />}
					</span>
				}
				actions={actions}
			/>
		</header>
	);
}
