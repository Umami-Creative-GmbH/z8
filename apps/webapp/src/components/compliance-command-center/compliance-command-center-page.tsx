"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "@/navigation";
import type { ComplianceCommandCenterData } from "@/lib/compliance-command-center/types";
import { ComplianceSectionCard } from "./compliance-section-card";
import { CoverageFooter } from "./coverage-footer";
import { RecentCriticalEventsList } from "./recent-critical-events-list";
import { RiskSummaryHeader } from "./risk-summary-header";

export function ComplianceCommandCenterPage({ data }: { data: ComplianceCommandCenterData }) {
	const router = useRouter();

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			startTransition(() => {
				router.refresh();
			});
		}, 120_000);

		return () => window.clearInterval(intervalId);
	}, [router]);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<RiskSummaryHeader summary={data.summary} />
			<div className="grid gap-4 xl:grid-cols-3">
				{data.sections.map((section) => (
					<ComplianceSectionCard key={section.key} section={section} />
				))}
			</div>
			<RecentCriticalEventsList events={data.recentCriticalEvents} />
			<CoverageFooter notes={data.coverageNotes} refreshedAt={data.refreshedAt} />
		</div>
	);
}
