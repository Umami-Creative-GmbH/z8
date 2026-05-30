"use client";

import { IconAlertTriangle, IconCalendarDue, IconGauge } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sortProjectHealthAlerts } from "@/lib/reports/project-health";
import type { ProjectHealthSeverity, ProjectSummary } from "@/lib/reports/project-types";
import { cn } from "@/lib/utils";

interface ProjectHealthAlertsProps {
	projects: ProjectSummary[];
	onProjectSelect: (projectId: string) => void;
}

export function ProjectHealthAlerts({ projects, onProjectSelect }: ProjectHealthAlertsProps) {
	const { t } = useTranslate();
	const alertProjects = sortProjectHealthAlerts(projects);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconAlertTriangle
						className="size-5 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					/>
					{t("reports.projects.healthAlerts.title", "Project Health Alerts")}
				</CardTitle>
				<CardDescription>
					{t(
						"reports.projects.healthAlerts.description",
						"Budget and deadline risks that need attention in this report period.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{alertProjects.length === 0 ? (
					<p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
						{t(
							"reports.projects.healthAlerts.empty",
							"No budget or deadline risks in this report period.",
						)}
					</p>
				) : (
					<ul className="space-y-3">
						{alertProjects.map((project) => (
							<li key={project.id} className="rounded-lg border p-4">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div className="min-w-0 space-y-2">
										<div className="flex flex-wrap items-center gap-2">
											<p className="min-w-0 break-words font-medium">{project.name}</p>
											<SeverityBadge severity={getProjectSeverity(project)} />
										</div>
										<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">
											{project.percentBudgetUsed !== null ? (
												<span className="inline-flex items-center gap-1 tabular-nums">
													<IconGauge className="size-4" aria-hidden="true" />
													{t("reports.projects.healthAlerts.budgetUsed", "{percent}% budget used", {
														percent: Math.round(project.percentBudgetUsed),
													})}
												</span>
											) : null}
											{project.daysUntilDeadline !== null ? (
												<span className="inline-flex items-center gap-1 tabular-nums">
													<IconCalendarDue className="size-4" aria-hidden="true" />
													{formatDeadlineContext(project.daysUntilDeadline, t)}
												</span>
											) : null}
										</div>
										<p className="text-sm">{getAlertReason(project, t)}</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										aria-label={t(
											"reports.projects.healthAlerts.viewDetailsForProject",
											"View details for {projectName}",
											{ projectName: project.name },
										)}
										onClick={() => onProjectSelect(project.id)}
										className="self-start"
									>
										{t("reports.projects.healthAlerts.viewDetails", "View details")}
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function SeverityBadge({ severity }: { severity: Exclude<ProjectHealthSeverity, "none"> }) {
	const { t } = useTranslate();
	const isCritical = severity === "critical";

	return (
		<Badge
			variant={isCritical ? "destructive" : "outline"}
			className={cn(
				isCritical
					? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
					: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
			)}
		>
			{isCritical
				? t("reports.projects.healthAlerts.critical", "Critical")
				: t("reports.projects.healthAlerts.warning", "Warning")}
		</Badge>
	);
}

function getProjectSeverity(project: ProjectSummary): Exclude<ProjectHealthSeverity, "none"> {
	return [project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity].includes(
		"critical",
	)
		? "critical"
		: "warning";
}

function formatDeadlineContext(daysUntilDeadline: number, t: ReturnType<typeof useTranslate>["t"]) {
	if (daysUntilDeadline === 0) {
		return t("reports.projects.healthAlerts.dueToday", "Due today");
	}

	if (daysUntilDeadline < 0) {
		return t("reports.projects.healthAlerts.daysOverdue", "{days}d overdue", {
			days: Math.abs(daysUntilDeadline),
		});
	}

	return t("reports.projects.healthAlerts.daysLeft", "{days}d left", {
		days: daysUntilDeadline,
	});
}

function getAlertReason(project: ProjectSummary, t: ReturnType<typeof useTranslate>["t"]) {
	if (project.budgetAlertType === "budget_100") {
		return t("reports.projects.healthAlerts.reason.overBudget", "Project is over budget.");
	}

	if (project.deadlineAlertType === "deadline_overdue") {
		return t("reports.projects.healthAlerts.reason.overdue", "Project deadline has passed.");
	}

	if (project.deadlineAlertType === "deadline_today") {
		return t("reports.projects.healthAlerts.reason.dueToday", "Project is due today.");
	}

	if (project.forecastMessage) {
		return project.forecastMessage;
	}

	if (project.budgetAlertType === "budget_90") {
		return t(
			"reports.projects.healthAlerts.reason.budget90",
			"Project has used at least 90% of its budget.",
		);
	}

	if (project.budgetAlertType === "budget_70") {
		return t(
			"reports.projects.healthAlerts.reason.budget70",
			"Project has used at least 70% of its budget.",
		);
	}

	if (project.deadlineAlertType !== null) {
		return t("reports.projects.healthAlerts.reason.deadline", "Project deadline is approaching.");
	}

	return t("reports.projects.healthAlerts.reason.default", "Project needs attention.");
}
