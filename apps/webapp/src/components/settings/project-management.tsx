"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getProjects,
	type ProjectWithDetails,
} from "@/app/[locale]/(app)/settings/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";
import {
	IconBriefcase,
	IconCalendar,
	IconClock,
	IconEdit,
	IconPlus,
	IconUsers,
} from "@tabler/icons-react";
import { ProjectDialog } from "./project-dialog";

interface ProjectManagementProps {
	organizationId: string;
}

const STATUS_COLORS: Record<string, string> = {
	planned: "bg-slate-500",
	active: "bg-green-500",
	paused: "bg-yellow-500",
	completed: "bg-blue-500",
	archived: "bg-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
	planned: "Planned",
	active: "Active",
	paused: "Paused",
	completed: "Completed",
	archived: "Archived",
};

export function ProjectManagement({ organizationId }: ProjectManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProject, setEditingProject] = useState<ProjectWithDetails | null>(null);

	const { data: projectsResult, isLoading } = useQuery({
		queryKey: queryKeys.projects.list(organizationId),
		queryFn: async () => {
			const result = await getProjects(organizationId);
			if (!result.success) throw new Error(result.error?.message);
			return result.data;
		},
	});

	const projects = projectsResult || [];

	const handleCreate = () => {
		setEditingProject(null);
		setDialogOpen(true);
	};

	const handleEdit = (project: ProjectWithDetails) => {
		setEditingProject(project);
		setDialogOpen(true);
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(organizationId) });
		setDialogOpen(false);
		setEditingProject(null);
	};

	const formatBudgetProgress = (project: ProjectWithDetails) => {
		if (!project.budgetHours) return null;
		const budgetHours = parseFloat(project.budgetHours);
		const percentage = Math.min((project.totalHoursBooked / budgetHours) * 100, 100);
		return {
			percentage,
			remaining: Math.max(budgetHours - project.totalHoursBooked, 0),
		};
	};

	const formatDeadline = (deadline: Date | null) => {
		if (!deadline) return null;
		const now = new Date();
		const diff = deadline.getTime() - now.getTime();
		const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

		if (days < 0) return { text: `${Math.abs(days)} days overdue`, isOverdue: true };
		if (days === 0) return { text: "Due today", isOverdue: false };
		if (days === 1) return { text: "Due tomorrow", isOverdue: false };
		return { text: `${days} days remaining`, isOverdue: false };
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.projects.title", "Projects")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.projects.description",
							"Manage projects, budgets, deadlines, and time assignments",
						)}
					</p>
				</div>
				<Button onClick={handleCreate}>
					<IconPlus className="mr-2 h-4 w-4" />
					{t("settings.projects.create", "Create Project")}
				</Button>
			</div>

			{isLoading ? (
				<Card>
					<CardContent className="p-6">
						<div className="space-y-4">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					</CardContent>
				</Card>
			) : projects.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<IconBriefcase className="h-12 w-12 text-muted-foreground/50" />
						<h3 className="mt-4 text-lg font-medium">
							{t("settings.projects.empty.title", "No projects yet")}
						</h3>
						<p className="mt-2 text-sm text-muted-foreground">
							{t(
								"settings.projects.empty.description",
								"Create your first project to start tracking time against it.",
							)}
						</p>
						<Button onClick={handleCreate} className="mt-4">
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.projects.create", "Create Project")}
						</Button>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.projects.list.title", "All Projects")}</CardTitle>
						<CardDescription>
							{t("settings.projects.list.description", "{count} projects total", {
								count: projects.length,
							})}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.projects.column.name", "Name")}</TableHead>
									<TableHead>{t("settings.projects.column.status", "Status")}</TableHead>
									<TableHead>{t("settings.projects.column.budget", "Budget")}</TableHead>
									<TableHead>{t("settings.projects.column.deadline", "Deadline")}</TableHead>
									<TableHead>{t("settings.projects.column.team", "Team")}</TableHead>
									<TableHead className="w-[100px]"></TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{projects.map((project) => {
									const budgetProgress = formatBudgetProgress(project);
									const deadline = formatDeadline(project.deadline);

									return (
										<TableRow key={project.id}>
											<TableCell>
												<div className="flex items-center gap-2">
													{project.color && (
														<div
															className="h-4 w-4 rounded-full"
															style={{ backgroundColor: project.color }}
														/>
													)}
													<div>
														<div className="font-medium">{project.name}</div>
														{project.description && (
															<div className="text-sm text-muted-foreground line-clamp-1">
																{project.description}
															</div>
														)}
													</div>
												</div>
											</TableCell>
											<TableCell>
												<Badge
													variant="secondary"
													className={`${STATUS_COLORS[project.status]} text-white`}
												>
													{STATUS_LABELS[project.status]}
												</Badge>
											</TableCell>
											<TableCell>
												{budgetProgress ? (
													<div className="w-32 space-y-1">
														<div className="flex justify-between text-xs">
															<span>{project.totalHoursBooked}h</span>
															<span className="text-muted-foreground">
																/ {project.budgetHours}h
															</span>
														</div>
														<Progress
															value={budgetProgress.percentage}
															className={
																budgetProgress.percentage >= 100
																	? "bg-red-100 [&>div]:bg-red-500"
																	: budgetProgress.percentage >= 90
																		? "bg-yellow-100 [&>div]:bg-yellow-500"
																		: ""
															}
														/>
													</div>
												) : (
													<span className="text-muted-foreground">-</span>
												)}
											</TableCell>
											<TableCell>
												{deadline ? (
													<div
														className={`flex items-center gap-1 text-sm ${deadline.isOverdue ? "text-red-600" : ""}`}
													>
														<IconCalendar className="h-4 w-4" />
														{deadline.text}
													</div>
												) : (
													<span className="text-muted-foreground">-</span>
												)}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-1 text-sm text-muted-foreground">
													<IconUsers className="h-4 w-4" />
													<span>
														{project.assignments.length}{" "}
														{project.assignments.length === 1 ? "member" : "members"}
													</span>
												</div>
											</TableCell>
											<TableCell>
												<Button variant="ghost" size="sm" onClick={() => handleEdit(project)}>
													<IconEdit className="h-4 w-4" />
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			<ProjectDialog
				organizationId={organizationId}
				project={editingProject}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={handleSuccess}
			/>
		</div>
	);
}
