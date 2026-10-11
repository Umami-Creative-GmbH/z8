/**
 * The export document of a shared snapshot (#806): the same project report
 * and customer view builders as the internal reports, with the share-safe
 * figure groups only. The recipient page renders it and downloads it as PDF,
 * CSV and Excel, so the page and the files show the same thing. Client-safe.
 */

import type { ReportDocument } from "@/lib/reports/exporters/report-document";
import {
	buildCustomerReportDocument,
	buildProjectReportDocument,
	type ProjectReportExportContext,
	SHARED_SNAPSHOT_FIGURE_GROUPS,
} from "@/lib/reports/project-report-export";
import type { SharedSnapshot } from "./shared-snapshot";

export function buildSharedSnapshotDocument(
	snapshot: SharedSnapshot,
	context: ProjectReportExportContext,
): ReportDocument {
	if (snapshot.kind === "project") {
		return buildProjectReportDocument(
			{
				...snapshot,
				employeeBreakdown:
					snapshot.employeeBreakdown.length > 0 ? snapshot.employeeBreakdown : undefined,
			},
			context,
			SHARED_SNAPSHOT_FIGURE_GROUPS,
		);
	}
	return buildCustomerReportDocument(
		{
			period: snapshot.period,
			billableTime: snapshot.billableTime,
			customers: [snapshot.customer],
			withoutCustomer: null,
			totals: snapshot.customer,
		},
		context,
		SHARED_SNAPSHOT_FIGURE_GROUPS,
	);
}
