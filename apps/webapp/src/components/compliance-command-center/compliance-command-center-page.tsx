"use client";

import { useTranslate } from "@tolgee/react";
import { startTransition, useEffect } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { ComplianceCommandCenterData } from "@/lib/compliance-command-center/types";
import { useRouter } from "@/navigation";
import { ComplianceSectionCard } from "./compliance-section-card";
import { CoverageFooter } from "./coverage-footer";
import { RecentCriticalEventsList } from "./recent-critical-events-list";
import { RiskSummaryHeader } from "./risk-summary-header";

export function CompliancePageLoading() {
	const { t } = useTranslate();
	return (
		<LoadingRegion
			className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6"
			label={{
				labelKey: "compliance.commandCenter.loading",
				labelDefault: "Loading compliance signals",
			}}
		>
			<PageHeader title={t("nav.compliance", "Compliance")} />
			<div aria-hidden="true" className="space-y-4">
				<Skeleton className="h-28 w-full" />
				<Skeleton className="h-80 w-full" />
			</div>
		</LoadingRegion>
	);
}

export function ComplianceCommandCenterPage({
	data,
}: {
	data: ComplianceCommandCenterData;
}) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const availableSections = data.sections
		.filter((section) => section.status !== "unavailable")
		.toSorted((left, right) => {
			const priority = { critical: 0, warning: 1, healthy: 2, unavailable: 3 };
			return priority[left.status] - priority[right.status];
		});
	const unavailableSections = data.sections.filter(
		(section) => section.status === "unavailable",
	);

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			startTransition(() => {
				refresh();
			});
		}, 120_000);

		return () => window.clearInterval(intervalId);
	}, [refresh]);

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
			<PageHeader
				title={t("nav.compliance", "Compliance")}
				scope={t("compliance.commandCenter.scope", "Active organization")}
			/>
			<RiskSummaryHeader summary={data.summary} t={t} />
			{availableSections.length > 0 ? (
				<section aria-labelledby="compliance-sections" className="space-y-3">
					<h2
						id="compliance-sections"
						className="text-lg font-semibold text-balance"
					>
						{t(
							"compliance.commandCenter.sections.title",
							"Compliance sections",
						)}
					</h2>
					<div className="divide-y rounded-xl border bg-card">
						{availableSections.map((section) => (
							<ComplianceSectionCard
								key={section.key}
								section={section}
								t={t}
							/>
						))}
					</div>
				</section>
			) : null}
			<RecentCriticalEventsList
				events={data.recentCriticalEvents}
				coverage={
					unavailableSections.length === 0
						? "available"
						: availableSections.length === 0
							? "unavailable"
							: "partial"
				}
				t={t}
			/>
			<CoverageFooter
				notes={data.coverageNotes}
				refreshedAt={data.refreshedAt}
				t={t}
			>
				{unavailableSections.length > 0 ? (
					<div className="divide-y rounded-lg border bg-card text-foreground">
						{unavailableSections.map((section) => (
							<ComplianceSectionCard
								key={section.key}
								section={section}
								t={t}
							/>
						))}
					</div>
				) : null}
			</CoverageFooter>
		</div>
	);
}
