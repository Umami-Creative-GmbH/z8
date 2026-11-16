"use client";

import {
	IconAlertTriangle,
	IconBriefcase,
	IconClock,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ProjectInfo } from "@/lib/reports/project-types";
import { useProjectHoursFormat } from "./use-project-hours-format";

interface ProjectSummaryCardsProps {
	data: {
		totalProjects: number;
		activeProjects: number;
		totalHours: number;
		projectsOverBudget: number;
		projectsOverdue: number;
	};
	isSingleProject?: boolean;
	project?: ProjectInfo;
	summary?: {
		totalHours: number;
		uniqueEmployees: number;
		workPeriodCount: number;
		averageHoursPerDay: number;
		budgetHours: number | null;
		percentBudgetUsed: number | null;
	};
}

export function ProjectSummaryCards({
	data,
	isSingleProject,
	project,
	summary,
}: ProjectSummaryCardsProps) {
	const { t } = useTranslate();
	const format = useProjectHoursFormat();

	if (isSingleProject && project && summary) {
		return (
			<dl className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card sm:grid-cols-2 xl:grid-cols-4">
				{/* Total Hours */}
				<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
					<div className="flex items-start justify-between gap-2">
						<dt className="text-sm text-muted-foreground">
							{t("reports.projects.cards.totalHours", "Total Hours")}
						</dt>
						<IconClock
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					</div>
					<dd>
						<div className="text-2xl font-semibold tracking-tight tabular-nums">
							{format.hours(summary.totalHours)}
						</div>
						<p className="text-xs text-muted-foreground">
							{t("reports.projects.cards.workPeriods", "{count} work periods", {
								count: summary.workPeriodCount,
							})}
						</p>
					</dd>
				</div>

				{/* Team Members */}
				<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
					<div className="flex items-start justify-between gap-2">
						<dt className="text-sm text-muted-foreground">
							{t("reports.projects.cards.teamMembers", "Team Members")}
						</dt>
						<IconUsers
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					</div>
					<dd>
						<div className="text-2xl font-semibold tracking-tight tabular-nums">
							{summary.uniqueEmployees}
						</div>
						<p className="text-xs text-muted-foreground">
							{t(
								"reports.projects.cards.activeContributors",
								"Active contributors",
							)}
						</p>
					</dd>
				</div>

				{/* Budget Status */}
				<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
					<div className="flex items-start justify-between gap-2">
						<dt className="text-sm text-muted-foreground">
							{t("reports.projects.cards.budgetUsed", "Budget Used")}
						</dt>
						<IconBriefcase
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					</div>
					<dd>
						<div className="text-2xl font-semibold tracking-tight tabular-nums">
							{summary.percentBudgetUsed !== null
								? `${summary.percentBudgetUsed.toFixed(0)}%`
								: t("reports.projects.cards.na", "N/A")}
						</div>
						<p className="text-xs text-muted-foreground">
							{summary.budgetHours !== null
								? t(
										"reports.projects.cards.hoursOfBudget",
										"{used}h of {total}h",
										{
											used: format.number(summary.totalHours),
											total: format.compactNumber(summary.budgetHours),
										},
									)
								: t("reports.projects.cards.noBudgetSet", "No budget set")}
						</p>
					</dd>
				</div>

				{/* Daily Average */}
				<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
					<div className="flex items-start justify-between gap-2">
						<dt className="text-sm text-muted-foreground">
							{t("reports.projects.cards.dailyAverage", "Daily Average")}
						</dt>
						<IconClock
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					</div>
					<dd>
						<div className="text-2xl font-semibold tracking-tight tabular-nums">
							{format.hours(summary.averageHoursPerDay)}
						</div>
						<p className="text-xs text-muted-foreground">
							{t("reports.projects.cards.hoursPerDay", "Hours per day")}
						</p>
					</dd>
				</div>
			</dl>
		);
	}

	return (
		<dl className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card sm:grid-cols-2 xl:grid-cols-5">
			{/* Total Projects */}
			<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
				<div className="flex items-start justify-between gap-2">
					<dt className="text-sm text-muted-foreground">
						{t("reports.projects.cards.totalProjects", "Total Projects")}
					</dt>
					<IconBriefcase
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</div>
				<dd>
					<div className="text-2xl font-semibold tracking-tight tabular-nums">
						{data.totalProjects}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.activeCount", "{count} active", {
							count: data.activeProjects,
						})}
					</p>
				</dd>
			</div>

			{/* Total Hours */}
			<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
				<div className="flex items-start justify-between gap-2">
					<dt className="text-sm text-muted-foreground">
						{t("reports.projects.cards.totalHours", "Total Hours")}
					</dt>
					<IconClock
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</div>
				<dd>
					<div className="text-2xl font-semibold tracking-tight tabular-nums">
						{format.hours(data.totalHours)}
					</div>
					<p className="text-xs text-muted-foreground">
						{t(
							"reports.projects.cards.acrossAllProjects",
							"Across all projects",
						)}
					</p>
				</dd>
			</div>

			{/* Active Projects */}
			<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
				<div className="flex items-start justify-between gap-2">
					<dt className="text-sm text-muted-foreground">
						{t("reports.projects.cards.activeProjects", "Active Projects")}
					</dt>
					<IconBriefcase
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</div>
				<dd>
					<div className="text-2xl font-semibold tracking-tight tabular-nums">
						{data.activeProjects}
					</div>
					<p className="text-xs text-muted-foreground">
						{t(
							"reports.projects.cards.currentlyInProgress",
							"Currently in progress",
						)}
					</p>
				</dd>
			</div>

			{/* Over Budget */}
			<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
				<div className="flex items-start justify-between gap-2">
					<dt className="text-sm text-muted-foreground">
						{t("reports.projects.cards.overBudget", "Over Budget")}
					</dt>
					<IconAlertTriangle
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</div>
				<dd>
					<div className="text-2xl font-semibold tracking-tight tabular-nums text-amber-600">
						{data.projectsOverBudget}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.exceededBudget", "Exceeded budget")}
					</p>
				</dd>
			</div>

			{/* Overdue */}
			<div className="min-w-0 space-y-2 border-b border-r p-4 last:border-b-0 sm:last:border-r-0">
				<div className="flex items-start justify-between gap-2">
					<dt className="text-sm text-muted-foreground">
						{t("reports.projects.cards.overdue", "Overdue")}
					</dt>
					<IconAlertTriangle
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</div>
				<dd>
					<div className="text-2xl font-semibold tracking-tight tabular-nums text-red-600">
						{data.projectsOverdue}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.pastDeadline", "Past deadline")}
					</p>
				</dd>
			</div>
		</dl>
	);
}
