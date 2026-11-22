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
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import {
	getProjects,
	type ProjectStatus,
	type ProjectWithDetails,
} from "@/app/[locale]/(app)/settings/projects/actions";
import { BillableRateActionPanel } from "@/components/billable-time/billable-rate-series";
import { BulkBillabilityActionPanel } from "@/components/billable-time/bulk-billability-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { SettingsListSkeleton } from "./settings-list-skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { systemClock } from "@/lib/datetime/temporal-core";
import { daysUntilProjectDeadline } from "@/lib/projects/project-deadline-days";
import { queryKeys } from "@/lib/query";
import {
	useBillableTimeEnabled,
	useOrganizationTimezone,
} from "@/stores/organization-settings-store";
import { MissingRequiredValuesBadge } from "./custom-fields/custom-field-values-section";
import { ProjectDialog } from "./project-dialog";
import { ProjectMembersPanel } from "./project-members-panel";
import { ProjectTasksPanel } from "./project-tasks-panel";
import { SaveProjectAsTemplatePanel } from "./save-project-as-template-panel";

interface ProjectManagementProps {
	organizationId: string;
	/** Only org admins may add or remove project managers (#367). */
	canManageProjectManagers: boolean;
	/**
	 * Inside the project settings tabs the page heading sits above the tabs, so
	 * the list renders only its actions; on its own it renders the page heading.
	 */
	embedded?: boolean;
}

type Translate = ReturnType<typeof useTranslate>["t"];

/** Status is told by its label; the badge style only separates live from finished work. */
const STATUS_BADGE_VARIANT: Record<ProjectStatus, "default" | "secondary" | "outline"> = {
	planned: "outline",
	active: "default",
	paused: "outline",
	completed: "secondary",
	archived: "secondary",
};

function projectStatusLabel(t: Translate, status: ProjectStatus) {
	switch (status) {
		case "planned":
			return t("settings.projects.status.planned", "Planned");
		case "active":
			return t("settings.projects.status.active", "Active");
		case "paused":
			return t("settings.projects.status.paused", "Paused");
		case "completed":
			return t("settings.projects.status.completed", "Completed");
		case "archived":
			return t("settings.projects.status.archived", "Archived");
	}
}

function formatBudgetProgress(project: ProjectWithDetails) {
	if (!project.budgetHours) return null;
	const budgetHours = parseFloat(project.budgetHours);
	const percentage = Math.min((project.totalHoursBooked / budgetHours) * 100, 100);
	return {
		budgetHours,
		percentage,
		remaining: Math.max(budgetHours - project.totalHoursBooked, 0),
	};
}

/**
 * Days to the deadline day in the organization's timezone, the same count
 * project reports and deadline notifications use (never the viewer's device).
 */
function formatDeadline(t: Translate, deadline: Date | null, timeZone: string) {
	if (!deadline) return null;
	const days = daysUntilProjectDeadline({
		deadline,
		now: systemClock.nowInstant(),
		timeZone,
	});

	if (days < 0) {
		return {
			text: t(
				"settings.projects.deadline.overdue",
				"{count, plural, one {# day overdue} other {# days overdue}}",
				{ count: Math.abs(days) },
			),
			isOverdue: true,
		};
	}
	if (days === 0) {
		return { text: t("settings.projects.deadline.today", "Due today"), isOverdue: false };
	}
	if (days === 1) {
		return { text: t("settings.projects.deadline.tomorrow", "Due tomorrow"), isOverdue: false };
	}
	return {
		text: t(
			"settings.projects.deadline.remaining",
			"{count, plural, one {# day remaining} other {# days remaining}}",
			{ count: days },
		),
		isOverdue: false,
	};
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
		isError,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.projects.list(organizationId),
		queryFn: async () => {
			const result = await getProjects();
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
		// A failed background refetch keeps the loaded list; only a failed first load shows the error.
		isError: isError && !projectsResult,
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
	embedded = false,
}: ProjectManagementProps) {
	const {
		t,
		refetch,
		isFetching,
		handleCreate,
		isLoading,
		isError,
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

	const actions = (
		<Button onClick={handleCreate}>
			<IconPlus aria-hidden="true" className="mr-2 size-4" />
			{t("settings.projects.create", "Create Project")}
		</Button>
	);

	return (
		<div className="flex flex-1 flex-col gap-6">
			{embedded ? (
				<div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
			) : (
				<PageHeader
					title={t("settings.projects.title", "Projects")}
					description={t(
						"settings.projects.description",
						"Manage projects, budgets, deadlines, and time assignments",
					)}
					actions={actions}
				/>
			)}

			{isLoading ? (
				// Mirrors the loaded list card: a titled header above the project rows.
				<SettingsListSkeleton />
			) : isError ? (
				<Card>
					<CardContent className="flex flex-col items-start gap-3">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.projects.loadFailed",
								"Projects could not be loaded. Check your connection and try again.",
							)}
						</p>
						<Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
							<IconRefresh aria-hidden="true" className="mr-2 size-4" />
							{t("common.retry", "Retry")}
						</Button>
					</CardContent>
				</Card>
			) : projects.length === 0 ? (
				<Card>
					<CardContent>
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<IconBriefcase aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle role="heading" aria-level={2}>
									{t("settings.projects.empty.title", "No projects yet")}
								</EmptyTitle>
								<EmptyDescription>
									{t(
										"settings.projects.empty.description",
										"Create your first project to start tracking time against it.",
									)}
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button onClick={handleCreate}>
									<IconPlus aria-hidden="true" className="mr-2 size-4" />
									{t("settings.projects.create", "Create Project")}
								</Button>
							</EmptyContent>
						</Empty>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle role="heading" aria-level={2}>
							{t("settings.projects.list.title", "All Projects")}
						</CardTitle>
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
	const locale = useLocale();
	const timeZone = useOrganizationTimezone();
	const hours = useMemo(
		() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
		[locale],
	);

	return (
		<Table mobileLayout="stacked">
			<TableHeader>
				<TableRow>
					<TableHead>{t("settings.projects.column.name", "Name")}</TableHead>
					<TableHead>{t("settings.projects.column.status", "Status")}</TableHead>
					<TableHead>{t("settings.projects.column.customer", "Customer")}</TableHead>
					<TableHead>{t("settings.projects.column.budget", "Budget")}</TableHead>
					<TableHead>{t("settings.projects.column.deadline", "Deadline")}</TableHead>
					<TableHead>{t("settings.projects.column.team", "Team")}</TableHead>
					<TableHead>{t("settings.projects.column.tasks", "Tasks")}</TableHead>
					<TableHead className="w-[100px]">
						<span className="sr-only">{t("settings.projects.column.actions", "Actions")}</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{projects.map((project) => {
					const budgetProgress = formatBudgetProgress(project);
					const deadline = formatDeadline(t, project.deadline, timeZone);

					return (
						<TableRow key={project.id}>
							<TableCell>
								<div className="flex min-w-0 items-center gap-2">
									{project.color && (
										<span
											className="size-4 shrink-0 rounded-full"
											style={{ backgroundColor: project.color }}
											aria-hidden="true"
										/>
									)}
									<div className="min-w-0 max-w-xs">
										<div className="truncate font-medium" title={project.name}>
											{project.name}
										</div>
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
								<Badge variant={STATUS_BADGE_VARIANT[project.status]}>
									{projectStatusLabel(t, project.status)}
								</Badge>
							</TableCell>
							<TableCell>
								{project.customerName ||
									(project.deletedCustomerName ? (
										// The project is without customer for Billable Time (#938).
										<span className="text-muted-foreground">
											{t("settings.projects.customerDeleted", "{name} (deleted)", {
												name: project.deletedCustomerName,
											})}
										</span>
									) : (
										<span className="text-muted-foreground">-</span>
									))}
							</TableCell>
							<TableCell>
								{budgetProgress ? (
									<div className="w-32 space-y-1">
										<div className="flex justify-between text-xs tabular-nums">
											<span>{hours.format(project.totalHoursBooked)}h</span>
											<span className="text-muted-foreground">
												/ {hours.format(budgetProgress.budgetHours)}h
											</span>
										</div>
										<Progress
											value={budgetProgress.percentage}
											aria-label={t("settings.projects.budgetUsed", "Budget used")}
											className={
												budgetProgress.percentage >= 100
													? "bg-destructive/20 [&>div]:bg-destructive"
													: budgetProgress.percentage >= 90
														? "bg-destructive/10 [&>div]:bg-destructive/70"
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
										className={`flex items-center gap-1 text-sm tabular-nums ${deadline.isOverdue ? "font-medium text-destructive" : ""}`}
									>
										<IconCalendar aria-hidden="true" className="size-4 shrink-0" />
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
								<div className="flex flex-wrap items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleEdit(project)}
										aria-label={t("settings.projects.editAction", "Edit {name}", {
											name: project.name,
										})}
										title={t("settings.projects.edit", "Edit project")}
									>
										<IconEdit aria-hidden="true" className="size-4" />
									</Button>
									{canSetBillableRates && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setRatesProject(project)}
											aria-label={t(
												"settings.billableTime.rates.projectRateTitle",
												"Billable rate for {name}",
												{ name: project.name },
											)}
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
