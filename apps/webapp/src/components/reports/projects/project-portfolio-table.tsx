"use client";

import { IconChartBar, IconChevronRight } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { DataTable, DataTableToolbar } from "@/components/data-table-server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProjectSummary } from "@/lib/reports/project-types";
import { cn } from "@/lib/utils";

interface ProjectPortfolioTableProps {
	projects: ProjectSummary[];
	onProjectSelect: (projectId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
	planned: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
	active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
	paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
	completed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
	archived: "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500",
};

export function ProjectPortfolioTable({ projects, onProjectSelect }: ProjectPortfolioTableProps) {
	const { t } = useTranslate();
	const [search, setSearch] = useState("");

	const formatDeadlineStatus = (daysUntilDeadline: number | null) => {
		if (daysUntilDeadline === null) return null;

		if (daysUntilDeadline < 0) {
			return (
				<Badge variant="destructive" className="text-xs">
					{t("reports.projects.table.daysOverdue", "{days}d overdue", {
						days: Math.abs(daysUntilDeadline),
					})}
				</Badge>
			);
		}
		if (daysUntilDeadline === 0) {
			return (
				<Badge variant="destructive" className="text-xs">
					{t("reports.projects.table.dueToday", "Due today")}
				</Badge>
			);
		}
		if (daysUntilDeadline <= 7) {
			return (
				<Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
					{t("reports.projects.table.daysLeft", "{days}d left", {
						days: daysUntilDeadline,
					})}
				</Badge>
			);
		}
		return (
			<span className="text-sm text-muted-foreground">
				{t("reports.projects.table.daysLeft", "{days}d left", {
					days: daysUntilDeadline,
				})}
			</span>
		);
	};

	const getStatusLabel = (status: string) => {
		const statusLabels: Record<string, string> = {
			planned: t("reports.projects.status.planned", "Planned"),
			active: t("reports.projects.status.active", "Active"),
			paused: t("reports.projects.status.paused", "Paused"),
			completed: t("reports.projects.status.completed", "Completed"),
			archived: t("reports.projects.status.archived", "Archived"),
		};
		return statusLabels[status] || status;
	};

	const getBudgetProgressColor = (percent: number | null) => {
		if (percent === null) return "bg-gray-200";
		if (percent >= 100) return "bg-red-500";
		if (percent >= 90) return "bg-amber-500";
		if (percent >= 70) return "bg-yellow-500";
		return "bg-green-500";
	};

	// Filter projects by search
	const filteredProjects = useMemo(() => {
		if (!search) return projects;
		const searchLower = search.toLowerCase();
		return projects.filter(
			(project) =>
				project.name.toLowerCase().includes(searchLower) ||
				project.description?.toLowerCase().includes(searchLower) ||
				project.status.toLowerCase().includes(searchLower),
		);
	}, [projects, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<ProjectSummary>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("reports.projects.table.project", "Project"),
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						{row.original.color && (
							<div
								className="h-3 w-3 rounded-full flex-shrink-0"
								style={{ backgroundColor: row.original.color }}
							/>
						)}
						<div>
							<div className="font-medium">{row.original.name}</div>
							{row.original.description && (
								<div className="text-xs text-muted-foreground line-clamp-1">
									{row.original.description}
								</div>
							)}
						</div>
					</div>
				),
			},
			{
				accessorKey: "status",
				header: t("reports.projects.table.status", "Status"),
				cell: ({ row }) => (
					<Badge variant="secondary" className={cn(STATUS_COLORS[row.original.status])}>
						{getStatusLabel(row.original.status)}
					</Badge>
				),
			},
			{
				accessorKey: "totalHours",
				header: () => (
					<div className="text-right">{t("reports.projects.table.hours", "Hours")}</div>
				),
				cell: ({ row }) => (
					<div className="text-right tabular-nums">{row.original.totalHours.toFixed(1)}h</div>
				),
			},
			{
				accessorKey: "budgetHours",
				header: t("reports.projects.table.budget", "Budget"),
				cell: ({ row }) => {
					const project = row.original;
					if (project.budgetHours === null) {
						return <span className="text-sm text-muted-foreground">—</span>;
					}
					return (
						<div className="w-32 space-y-1">
							<div className="flex justify-between text-xs">
								<span className="text-muted-foreground">
									{project.percentBudgetUsed?.toFixed(0)}%
								</span>
								<span className="text-muted-foreground">{project.budgetHours}h</span>
							</div>
							<Progress
								value={Math.min(project.percentBudgetUsed ?? 0, 100)}
								className={cn("h-2", getBudgetProgressColor(project.percentBudgetUsed))}
							/>
						</div>
					);
				},
			},
			{
				accessorKey: "deadline",
				header: t("reports.projects.table.deadline", "Deadline"),
				cell: ({ row }) => {
					const project = row.original;
					if (!project.deadline) {
						return <span className="text-sm text-muted-foreground">—</span>;
					}
					return (
						<div className="flex flex-col gap-1">
							<span className="text-sm">{project.deadline.toLocaleDateString()}</span>
							{formatDeadlineStatus(project.daysUntilDeadline)}
						</div>
					);
				},
			},
			{
				accessorKey: "uniqueEmployees",
				header: () => <div className="text-right">{t("reports.projects.table.team", "Team")}</div>,
				cell: ({ row }) => (
					<div className="text-right tabular-nums">{row.original.uniqueEmployees}</div>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onProjectSelect(row.original.id)}
						className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
						aria-label={t("reports.projects.table.viewProject", "View project details")}
					>
						<IconChevronRight className="h-4 w-4" />
					</Button>
				),
			},
		],
		[t, onProjectSelect],
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("reports.projects.table.portfolioTitle", "Project Portfolio")}</CardTitle>
				<CardDescription>
					{t(
						"reports.projects.table.portfolioDescription",
						"Overview of all projects with budget and time tracking metrics",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t(
						"reports.projects.table.searchPlaceholder",
						"Search by name, description, or status...",
					)}
				/>

				<DataTable
					columns={columns}
					data={filteredProjects}
					emptyMessage={
						search
							? t(
									"reports.projects.table.noProjectsMatch",
									"No projects match the selected filters",
								)
							: t("reports.projects.table.noProjectsFound", "No projects found")
					}
				/>
			</CardContent>
		</Card>
	);
}
