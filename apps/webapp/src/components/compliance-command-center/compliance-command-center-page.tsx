"use client";

import { useTranslate } from "@tolgee/react";
import { startTransition, useEffect } from "react";
import type { ComplianceCommandCenterData } from "@/lib/compliance-command-center/types";
import { useRouter } from "@/navigation";
import { ComplianceSectionCard } from "./compliance-section-card";
import { CoverageFooter } from "./coverage-footer";
import { RecentCriticalEventsList } from "./recent-critical-events-list";
import { RiskSummaryHeader } from "./risk-summary-header";

export function ComplianceCommandCenterPage({ data }: { data: ComplianceCommandCenterData }) {
	const { t } = useTranslate();
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
			<RiskSummaryHeader summary={data.summary} t={t} />
			<div className="grid gap-4 xl:grid-cols-3">
				{data.sections.map((section) => (
					<ComplianceSectionCard key={section.key} section={section} t={t} />
				))}
			</div>
			<RecentCriticalEventsList events={data.recentCriticalEvents} t={t} />
			<CoverageFooter notes={data.coverageNotes} refreshedAt={data.refreshedAt} t={t} />
		</div>
	);
}
