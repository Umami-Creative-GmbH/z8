"use client";

import {
	IconBriefcase,
	IconCalendar,
	IconCoin,
	IconEdit,
	IconListCheck,
	IconPlus,
	IconRefresh,
	IconTemplate,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getProjects,
	type ProjectWithDetails,
} from "@/app/[locale]/(app)/settings/projects/actions";
import { BillableRateActionPanel } from "@/components/billable-time/billable-rate-series";
import { BulkBillabilityActionPanel } from "@/components/billable-time/bulk-billability-panel";
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
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";
import { MissingRequiredValuesBadge } from "./custom-fields/custom-field-values-section";
import { ProjectDialog } from "./project-dialog";
import { ProjectMembersPanel } from "./project-members-panel";
import { ProjectTasksPanel } from "./project-tasks-panel";
import { SaveProjectAsTemplatePanel } from "./save-project-as-template-panel";

interface ProjectManagementProps {
	organizationId: string;
	/** Only org admins may add or remove project managers (#367). */
	canManageProjectManagers: boolean;
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

function formatBudgetProgress(project: ProjectWithDetails) {
	if (!project.budgetHours) return null;
	const budgetHours = parseFloat(project.budgetHours);
	const percentage = Math.min((project.totalHoursBooked / budgetHours) * 100, 100);
	return {
		percentage,
		remaining: Math.max(budgetHours - project.totalHoursBooked, 0),
	};
}

function formatDeadline(deadline: Date | null) {
	if (!deadline) return null;
	const now = new Date();
	const diff = deadline.getTime() - now.getTime();
	const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

	if (days < 0) return { text: `${Math.abs(days)} days overdue`, isOverdue: true };
	if (days === 0) return { text: "Due today", isOverdue: false };
	if (days === 1) return { text: "Due tomorrow", isOverdue: false };
	return { text: `${days} days remaining`, isOverdue: false };
}

function useProjectManagement({
	organizationId,
	canManageProjectManagers,
}: ProjectManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProject, setEditingProject] = useState<ProjectWithDetails | null>(null);
	const [membersProjectId, setMembersProjectId] = useState<string | null>(null);
	const [ratesProject, setRatesProject] = useState<ProjectWithDetails | null>(null);
	const [bulkProject, setBulkProject] = useState<ProjectWithDetails | null>(null);
	// Billable rates are for owners and admins only (#898); the actions check again.
	const canSetBillableRates = useBillableTimeEnabled() && canManageProjectManagers;
	const [tasksProjectId, setTasksProjectId] = useState<string | null>(null);
	const [templateSourceId, setTemplateSourceId] = useState<string | null>(null);

	const {
		data: projectsResult,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.projects.list(organizationId),
		queryFn: async () => {
			const result = await getProjects(organizationId);
			if (!result.success) throw new Error(result.error ?? "Unknown error");
			return result.data;
		},
	});

	const projects = projectsResult || [];
	// Read from the list so the panel reflects refetched assignments.
	const membersProject = projects.find((project) => project.id === membersProjectId) ?? null;
	const tasksProject = projects.find((project) => project.id === tasksProjectId) ?? null;
	const templateSource = projects.find((project) => project.id === templateSourceId) ?? null;

	const handleCreate = () => {
		setEditingProject(null);
		setDialogOpen(true);
	};

	const handleEdit = (project: ProjectWithDetails) => {
		setEditingProject(project);
		setDialogOpen(true);
	};

	const handleMembersChanged = () => {
		// Assignments also change which projects are bookable, so refresh every project query.
		queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(organizationId) });
		setDialogOpen(false);
		setEditingProject(null);
	};

	return {
		t,
		refetch,
		isFetching,
		handleCreate,
		isLoading,
		projects,
		setMembersProjectId,
		setTasksProjectId,
		handleEdit,
		canSetBillableRates,
		setRatesProject,
		setBulkProject,
		canManageProjectManagers,
		setTemplateSourceId,
		organizationId,
		editingProject,
		dialogOpen,
		setDialogOpen,
		handleSuccess,
		membersProject,
		handleMembersChanged,
		ratesProject,
		bulkProject,
		templateSource,
		tasksProject,
	};
}

export function ProjectManagement({
	organizationId,
	canManageProjectManagers,
}: ProjectManagementProps) {
	const {
		t,
		refetch,
		isFetching,
		handleCreate,
		isLoading,
		projects,
		setMembersProjectId,
		setTasksProjectId,
		handleEdit,
		canSetBillableRates,
		setRatesProject,
		setBulkProject,
		setTemplateSourceId,
		editingProject,
		dialogOpen,
		setDialogOpen,
		handleSuccess,
		membersProject,
		handleMembersChanged,
		ratesProject,
		bulkProject,
		templateSource,
		tasksProject,
	} = useProjectManagement({ organizationId, canManageProjectManagers });
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
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
					<Button onClick={handleCreate}>
						<IconPlus className="mr-2 size-4" />
						{t("settings.projects.create", "Create Project")}
					</Button>
				</div>
			</div>

			{isLoading ? (
				// Mirrors the loaded list card: a titled header above the project rows.
				<Card aria-busy="true">
					<CardHeader className="space-y-2">
						<Skeleton className="h-6 w-40" />
						<Skeleton className="h-4 w-28" />
					</CardHeader>
					<CardContent className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</CardContent>
				</Card>
			) : projects.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<IconBriefcase className="size-12 text-muted-foreground" />
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
							<IconPlus className="mr-2 size-4" />
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
						<ProjectManagementTable
							t={t}
							projects={projects}
							setMembersProjectId={setMembersProjectId}
							setTasksProjectId={setTasksProjectId}
							handleEdit={handleEdit}
							canSetBillableRates={canSetBillableRates}
							setRatesProject={setRatesProject}
							setBulkProject={setBulkProject}
							canManageProjectManagers={canManageProjectManagers}
							setTemplateSourceId={setTemplateSourceId}
						/>
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

			<ProjectMembersPanel
				organizationId={organizationId}
				project={membersProject}
				open={membersProject !== null}
				onOpenChange={(open) => {
					if (!open) setMembersProjectId(null);
				}}
				canManageProjectManagers={canManageProjectManagers}
				onChanged={handleMembersChanged}
			/>

			{canSetBillableRates && (
				<BillableRateActionPanel
					open={ratesProject !== null}
					onOpenChange={(open) => {
						if (!open) setRatesProject(null);
					}}
					target={ratesProject ? { level: "project", projectId: ratesProject.id } : null}
					title={t("settings.billableTime.rates.projectRateTitle", "Billable rate for {name}", {
						name: ratesProject?.name ?? "",
					})}
					description={t(
						"settings.billableTime.rates.level.projectDescription",
						"Applies to all work on the project without an employee-on-project rate.",
					)}
				/>
			)}

			{canSetBillableRates && (
				<BulkBillabilityActionPanel
					open={bulkProject !== null}
					onOpenChange={(open) => {
						if (!open) setBulkProject(null);
					}}
					project={bulkProject}
				/>
			)}
			<SaveProjectAsTemplatePanel
				organizationId={organizationId}
				project={templateSource}
				open={templateSource !== null}
				onOpenChange={(open) => {
					if (!open) setTemplateSourceId(null);
				}}
			/>

			<ProjectTasksPanel
				project={tasksProject}
				open={tasksProject !== null}
				onOpenChange={(open) => {
					if (!open) setTasksProjectId(null);
				}}
			/>
		</div>
	);
}

function ProjectManagementTable({
	t,
	projects,
	setMembersProjectId,
	setTasksProjectId,
	handleEdit,
	canSetBillableRates,
	setRatesProject,
	setBulkProject,
	canManageProjectManagers,
	setTemplateSourceId,
}: Pick<
	ReturnType<typeof useProjectManagement>,
	| "t"
	| "projects"
	| "setMembersProjectId"
	| "setTasksProjectId"
	| "handleEdit"
	| "canSetBillableRates"
	| "setRatesProject"
	| "setBulkProject"
	| "canManageProjectManagers"
	| "setTemplateSourceId"
>) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{t("settings.projects.column.name", "Name")}</TableHead>
					<TableHead>{t("settings.projects.column.status", "Status")}</TableHead>
					<TableHead>{t("settings.projects.column.customer", "Customer")}</TableHead>
					<TableHead>{t("settings.projects.column.budget", "Budget")}</TableHead>
					<TableHead>{t("settings.projects.column.deadline", "Deadline")}</TableHead>
					<TableHead>{t("settings.projects.column.team", "Team")}</TableHead>
					<TableHead>{t("settings.projects.column.tasks", "Tasks")}</TableHead>
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
											className="size-4 rounded-full"
											style={{ backgroundColor: project.color }}
										/>
									)}
									<div>
										<div className="font-medium">{project.name}</div>
										{project.missingRequiredCustomFields && (
											<MissingRequiredValuesBadge className="mt-1" />
										)}
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
								{project.customerName || <span className="text-muted-foreground">-</span>}
							</TableCell>
							<TableCell>
								{budgetProgress ? (
									<div className="w-32 space-y-1">
										<div className="flex justify-between text-xs">
											<span>{project.totalHoursBooked}h</span>
											<span className="text-muted-foreground">/ {project.budgetHours}h</span>
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
										<IconCalendar className="size-4" />
										{deadline.text}
									</div>
								) : (
									<span className="text-muted-foreground">-</span>
								)}
							</TableCell>
							<TableCell>
								<Button
									variant="ghost"
									size="sm"
									className="gap-1 text-muted-foreground"
									onClick={() => setMembersProjectId(project.id)}
								>
									<IconUsers className="size-4" aria-hidden="true" />
									{t(
										"settings.projects.members.count",
										"{count, plural, one {# member} other {# members}}",
										{ count: project.assignments.length },
									)}
									<span className="sr-only">
										{t("settings.projects.members.manage", "Manage members of {name}", {
											name: project.name,
										})}
									</span>
								</Button>
							</TableCell>
							<TableCell>
								<Button
									variant="ghost"
									size="sm"
									className="gap-1 text-muted-foreground"
									onClick={() => setTasksProjectId(project.id)}
								>
									<IconListCheck className="size-4" aria-hidden="true" />
									{t("settings.projects.tasks.open", "Tasks")}
									<span className="sr-only">
										{t("settings.projects.tasks.manage", "Manage tasks of {name}", {
											name: project.name,
										})}
									</span>
								</Button>
							</TableCell>
							<TableCell>
								<div className="flex items-center gap-1">
									<Button variant="ghost" size="sm" onClick={() => handleEdit(project)}>
										<IconEdit className="size-4" />
									</Button>
									{canSetBillableRates && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setRatesProject(project)}
											aria-label={t("settings.billableTime.rates.projectRate", "Billable rate")}
											title={t("settings.billableTime.rates.projectRate", "Billable rate")}
										>
											<IconCoin aria-hidden="true" className="size-4" />
										</Button>
									)}
									{canSetBillableRates && project.customerId && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setBulkProject(project)}
											aria-label={t("settings.billableTime.bulk.open", "Mark work billable")}
											title={t("settings.billableTime.bulk.open", "Mark work billable")}
										>
											<IconListCheck aria-hidden="true" className="size-4" />
										</Button>
									)}
									{/* Saving as a template is for org owners and admins (#880). */}
									{canManageProjectManagers && (
										<Button
											variant="ghost"
											size="sm"
											aria-label={t(
												"settings.projects.saveAsTemplate.action",
												"Save {name} as template",
												{ name: project.name },
											)}
											title={t("settings.projects.saveAsTemplate.title", "Save as template")}
											onClick={() => setTemplateSourceId(project.id)}
										>
											<IconTemplate className="size-4" aria-hidden="true" />
										</Button>
									)}
								</div>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
