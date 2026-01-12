"use client";

import { IconAlertTriangle, IconBriefcase, IconClock, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectInfo } from "@/lib/reports/project-types";

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

	if (isSingleProject && project && summary) {
		return (
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{/* Total Hours */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("reports.projects.cards.totalHours", "Total Hours")}
						</CardTitle>
						<IconClock className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{summary.totalHours.toFixed(1)}h</div>
						<p className="text-xs text-muted-foreground">
							{t("reports.projects.cards.workPeriods", "{count} work periods", {
								count: summary.workPeriodCount,
							})}
						</p>
					</CardContent>
				</Card>

				{/* Team Members */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("reports.projects.cards.teamMembers", "Team Members")}
						</CardTitle>
						<IconUsers className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{summary.uniqueEmployees}</div>
						<p className="text-xs text-muted-foreground">
							{t("reports.projects.cards.activeContributors", "Active contributors")}
						</p>
					</CardContent>
				</Card>

				{/* Budget Status */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("reports.projects.cards.budgetUsed", "Budget Used")}
						</CardTitle>
						<IconBriefcase className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{summary.percentBudgetUsed !== null
								? `${summary.percentBudgetUsed.toFixed(0)}%`
								: t("reports.projects.cards.na", "N/A")}
						</div>
						<p className="text-xs text-muted-foreground">
							{summary.budgetHours !== null
								? t("reports.projects.cards.hoursOfBudget", "{used}h of {total}h", {
										used: summary.totalHours.toFixed(1),
										total: summary.budgetHours,
									})
								: t("reports.projects.cards.noBudgetSet", "No budget set")}
						</p>
					</CardContent>
				</Card>

				{/* Daily Average */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							{t("reports.projects.cards.dailyAverage", "Daily Average")}
						</CardTitle>
						<IconClock className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{summary.averageHoursPerDay.toFixed(1)}h</div>
						<p className="text-xs text-muted-foreground">
							{t("reports.projects.cards.hoursPerDay", "Hours per day")}
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
			{/* Total Projects */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.projects.cards.totalProjects", "Total Projects")}
					</CardTitle>
					<IconBriefcase className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{data.totalProjects}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.activeCount", "{count} active", {
							count: data.activeProjects,
						})}
					</p>
				</CardContent>
			</Card>

			{/* Total Hours */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.projects.cards.totalHours", "Total Hours")}
					</CardTitle>
					<IconClock className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{data.totalHours.toFixed(1)}h</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.acrossAllProjects", "Across all projects")}
					</p>
				</CardContent>
			</Card>

			{/* Active Projects */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.projects.cards.activeProjects", "Active Projects")}
					</CardTitle>
					<IconBriefcase className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{data.activeProjects}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.currentlyInProgress", "Currently in progress")}
					</p>
				</CardContent>
			</Card>

			{/* Over Budget */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.projects.cards.overBudget", "Over Budget")}
					</CardTitle>
					<IconAlertTriangle className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold text-amber-600">{data.projectsOverBudget}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.exceededBudget", "Exceeded budget")}
					</p>
				</CardContent>
			</Card>

			{/* Overdue */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t("reports.projects.cards.overdue", "Overdue")}
					</CardTitle>
					<IconAlertTriangle className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold text-red-600">{data.projectsOverdue}</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.projects.cards.pastDeadline", "Past deadline")}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
