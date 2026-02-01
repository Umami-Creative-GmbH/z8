"use client";

import { useTranslate } from "@tolgee/react";
import { IconAlertTriangle, IconCircleCheck, IconExclamationCircle, IconInfoCircle } from "@tabler/icons-react";
import type { ComplianceStats } from "@/app/[locale]/(app)/settings/compliance-radar/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ComplianceRadarStatsProps {
	stats: ComplianceStats;
}

export function ComplianceRadarStats({ stats }: ComplianceRadarStatsProps) {
	const { t } = useTranslate();

	const trendLabel = {
		improving: t("complianceRadar.trend.improving", "Improving"),
		stable: t("complianceRadar.trend.stable", "Stable"),
		worsening: t("complianceRadar.trend.worsening", "Needs attention"),
	};

	const trendColors = {
		improving: "text-green-600",
		stable: "text-muted-foreground",
		worsening: "text-orange-600",
	};

	return (
		<div className="grid gap-4 md:grid-cols-4">
			{/* Total Open */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("complianceRadar.stats.totalOpen", "Open Findings")}
					</CardTitle>
					<IconExclamationCircle className="size-4 text-muted-foreground" aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{stats.totalOpen}</div>
					<p className={cn("text-xs", trendColors[stats.recentTrend])}>
						{trendLabel[stats.recentTrend]}
					</p>
				</CardContent>
			</Card>

			{/* Critical */}
			<Card className={stats.bySeverity.critical > 0 ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950" : ""}>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("complianceRadar.stats.critical", "Critical")}
					</CardTitle>
					<IconAlertTriangle className={cn("size-4", stats.bySeverity.critical > 0 ? "text-red-600" : "text-muted-foreground")} aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className={cn("text-2xl font-bold", stats.bySeverity.critical > 0 && "text-red-600")}>
						{stats.bySeverity.critical}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("complianceRadar.stats.criticalDesc", "Requires immediate action")}
					</p>
				</CardContent>
			</Card>

			{/* Warning */}
			<Card className={stats.bySeverity.warning > 0 ? "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950" : ""}>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("complianceRadar.stats.warning", "Warnings")}
					</CardTitle>
					<IconExclamationCircle className={cn("size-4", stats.bySeverity.warning > 0 ? "text-orange-600" : "text-muted-foreground")} aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className={cn("text-2xl font-bold", stats.bySeverity.warning > 0 && "text-orange-600")}>
						{stats.bySeverity.warning}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("complianceRadar.stats.warningDesc", "Should be reviewed")}
					</p>
				</CardContent>
			</Card>

			{/* Info */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("complianceRadar.stats.info", "Info")}
					</CardTitle>
					<IconInfoCircle className="size-4 text-muted-foreground" aria-hidden="true" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{stats.bySeverity.info}</div>
					<p className="text-xs text-muted-foreground">
						{t("complianceRadar.stats.infoDesc", "For awareness")}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
