"use client";

import { IconChartBar, IconChevronRight } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	const formatDeadlineStatus = (daysUntilDeadline: number | null) => {
		if (daysUntilDeadline === null) return null;

		if (daysUntilDeadline < 0) {
			return (
				<Badge variant="destructive" className="text-xs">
					{Math.abs(daysUntilDeadline)}d overdue
				</Badge>
			);
		}
		if (daysUntilDeadline === 0) {
			return (
				<Badge variant="destructive" className="text-xs">
					Due today
				</Badge>
			);
		}
		if (daysUntilDeadline <= 7) {
			return (
				<Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
					{daysUntilDeadline}d left
				</Badge>
			);
		}
		return <span className="text-sm text-muted-foreground">{daysUntilDeadline}d left</span>;
	};

	const getBudgetProgressColor = (percent: number | null) => {
		if (percent === null) return "bg-gray-200";
		if (percent >= 100) return "bg-red-500";
		if (percent >= 90) return "bg-amber-500";
		if (percent >= 70) return "bg-yellow-500";
		return "bg-green-500";
	};

	if (projects.length === 0) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<div className="flex flex-col items-center gap-4 text-center">
						<IconChartBar className="h-12 w-12 text-muted-foreground" />
						<div>
							<p className="font-semibold">No projects found</p>
							<p className="text-sm text-muted-foreground">
								No projects match the selected filters
							</p>
						</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Project Portfolio</CardTitle>
				<CardDescription>
					Overview of all projects with budget and time tracking metrics
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Project</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Hours</TableHead>
							<TableHead>Budget</TableHead>
							<TableHead>Deadline</TableHead>
							<TableHead className="text-right">Team</TableHead>
							<TableHead className="w-[50px]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{projects.map((project) => (
							<TableRow key={project.id} className="group">
								<TableCell>
									<div className="flex items-center gap-2">
										{project.color && (
											<div
												className="h-3 w-3 rounded-full"
												style={{ backgroundColor: project.color }}
											/>
										)}
										<div>
											<div className="font-medium">{project.name}</div>
											{project.description && (
												<div className="text-xs text-muted-foreground line-clamp-1">
													{project.description}
												</div>
											)}
										</div>
									</div>
								</TableCell>
								<TableCell>
									<Badge
										variant="secondary"
										className={cn("capitalize", STATUS_COLORS[project.status])}
									>
										{project.status}
									</Badge>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{project.totalHours.toFixed(1)}h
								</TableCell>
								<TableCell>
									{project.budgetHours !== null ? (
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
									) : (
										<span className="text-sm text-muted-foreground">—</span>
									)}
								</TableCell>
								<TableCell>
									{project.deadline ? (
										<div className="flex flex-col gap-1">
											<span className="text-sm">{project.deadline.toLocaleDateString()}</span>
											{formatDeadlineStatus(project.daysUntilDeadline)}
										</div>
									) : (
										<span className="text-sm text-muted-foreground">—</span>
									)}
								</TableCell>
								<TableCell className="text-right">
									<span className="text-sm tabular-nums">{project.uniqueEmployees}</span>
								</TableCell>
								<TableCell>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => onProjectSelect(project.id)}
										className="opacity-0 group-hover:opacity-100 transition-opacity"
									>
										<IconChevronRight className="h-4 w-4" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
