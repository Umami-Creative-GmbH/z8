"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { ScheduleComplianceSummary } from "@/lib/scheduling/compliance/types";

interface ScheduleComplianceBannerProps {
	summary?: ScheduleComplianceSummary | null;
}

export function ScheduleComplianceBanner({ summary }: ScheduleComplianceBannerProps) {
	const { t } = useTranslate();

	if (!summary || summary.totalFindings === 0) {
		return null;
	}

	return (
		<Alert className="border-amber-300/70 bg-amber-50/60 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100">
			<IconAlertTriangle className="mt-0.5" aria-hidden="true" />
			<AlertTitle>
				{t("scheduling.scheduler.complianceBanner.title", "Compliance Warnings in This Date Range")}
			</AlertTitle>
			<AlertDescription className="space-y-2 text-amber-900/90 dark:text-amber-100/90">
				<p>
					{t(
						"scheduling.scheduler.complianceBanner.findingsDetected",
						"{count} finding(s) detected before publish.",
						{ count: summary.totalFindings },
					)}
				</p>
				<div className="flex flex-wrap gap-2">
					<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
						{t("scheduling.scheduler.complianceBanner.restTime", "Rest time: {count}", {
							count: summary.byType.restTime,
						})}
					</Badge>
					<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
						{t("scheduling.scheduler.complianceBanner.maxHours", "Max hours: {count}", {
							count: summary.byType.maxHours,
						})}
					</Badge>
					<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
						{t("scheduling.scheduler.complianceBanner.overtime", "Overtime: {count}", {
							count: summary.byType.overtime,
						})}
					</Badge>
				</div>
			</AlertDescription>
		</Alert>
	);
}
