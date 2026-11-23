"use client";

import { ReportShareLinkList } from "@/components/reports/projects/report-share-link-list";
import { useRouter } from "@/navigation";

/**
 * Organization-wide report share link list for Settings. Refreshes the route
 * after a link is revoked so Settings navigation re-evaluates
 * `hasActiveReportShareLinks` when Projects is turned off (#1961).
 */
export function ReportShareLinksList() {
	const router = useRouter();
	return <ReportShareLinkList showReport onRevoked={() => router.refresh()} />;
}
