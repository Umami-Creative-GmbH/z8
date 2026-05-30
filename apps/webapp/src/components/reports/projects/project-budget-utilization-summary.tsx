"use client";

import { IconAlertTriangle, IconChartBar, IconGauge, IconTrendingUp } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectBudgetHealthTotals } from "@/lib/reports/project-types";
import { cn } from "@/lib/utils";

interface ProjectBudgetUtilizationSummaryProps {
	totals: ProjectBudgetHealthTotals;
}

export function ProjectBudgetUtilizationSummary({ totals }: ProjectBudgetUtilizationSummaryProps) {
	const { t } = useTranslate();

	const cards = [
		{
			key: "atOrAbove70",
			title: t("reports.projects.healthSummary.atOrAbove70", "At or above 70%"),
			value: totals.projectsAtOrAbove70Budget,
			description: t(
				"reports.projects.healthSummary.atOrAbove70Description",
				"Budget usage elevated",
			),
			icon: IconChartBar,
			valueClassName: "text-amber-600 dark:text-amber-400",
			iconClassName: "text-amber-600 dark:text-amber-400",
		},
		{
			key: "atOrAbove90",
			title: t("reports.projects.healthSummary.atOrAbove90", "At or above 90%"),
			value: totals.projectsAtOrAbove90Budget,
			description: t("reports.projects.healthSummary.atOrAbove90Description", "Near budget limit"),
			icon: IconGauge,
			valueClassName: "text-amber-700 dark:text-amber-300",
			iconClassName: "text-amber-700 dark:text-amber-300",
		},
		{
			key: "overBudget",
			title: t("reports.projects.healthSummary.overBudget", "Over budget"),
			value: totals.projectsOverBudget,
			description: t("reports.projects.healthSummary.overBudgetDescription", "Budget exceeded"),
			icon: IconAlertTriangle,
			valueClassName: "text-red-600 dark:text-red-400",
			iconClassName: "text-red-600 dark:text-red-400",
		},
		{
			key: "forecastAtRisk",
			title: t("reports.projects.healthSummary.forecastAtRisk", "Forecast at risk"),
			value: totals.projectsForecastAtRisk,
			description: t(
				"reports.projects.healthSummary.forecastAtRiskDescription",
				"Projected to exceed plan",
			),
			icon: IconTrendingUp,
			valueClassName: "text-red-600 dark:text-red-400",
			iconClassName: "text-red-600 dark:text-red-400",
		},
	];

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{cards.map((card) => {
				const Icon = card.icon;

				return (
					<Card key={card.key}>
						<CardHeader className="flex flex-row items-center justify-between gap-0 pb-2">
							<CardTitle className="text-sm font-medium">{card.title}</CardTitle>
							<Icon className={cn("size-4", card.iconClassName)} aria-hidden="true" />
						</CardHeader>
						<CardContent>
							<div className={cn("font-bold text-2xl tabular-nums", card.valueClassName)}>
								{card.value}
							</div>
							<p className="text-muted-foreground text-xs">{card.description}</p>
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}
