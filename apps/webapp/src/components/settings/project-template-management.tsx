"use client";

import { IconEdit, IconPlus, IconRefresh, IconTemplate, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteProjectTemplate,
	getProjectTemplateDetails,
	getProjectTemplates,
} from "@/app/[locale]/(app)/settings/projects/template-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ProjectTemplateSummary } from "@/lib/projects/project-template-model";
import { queryKeys } from "@/lib/query";
import { InlineDeleteConfirm } from "./inline-delete-confirm";
import { ProjectTemplateForm } from "./project-template-form";
import { TemplateIcon } from "./project-template-icon";

/**
 * The project templates section of the project settings (#878), shown to org
 * owners and admins only. A template is a blueprint, never a project: it holds
 * tasks, a budget, a deadline offset, managers and assignments that a new
 * project copies once. The form lives in ./project-template-form.
 */
function ProjectTemplateDialog({
	organizationId,
	templateId,
	open,
	onOpenChange,
	onSaved,
}: {
	organizationId: string;
	/** Null creates a new template. */
	templateId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const { data: template, isLoading } = useQuery({
		queryKey: queryKeys.projects.templateDetail(templateId ?? ""),
		queryFn: async () => {
			const result = await getProjectTemplateDetails(templateId ?? "");
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && templateId !== null,
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{templateId
							? t("settings.projects.templates.editTitle", "Edit template")
							: t("settings.projects.templates.createTitle", "Create template")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.projects.templates.dialogDescription",
							"New projects created from this template copy its contents once.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				{open &&
					(templateId === null ? (
						<ProjectTemplateForm
							organizationId={organizationId}
							template={null}
							onCancel={() => onOpenChange(false)}
							onSaved={onSaved}
						/>
					) : isLoading || !template ? (
						<ActionPanelBody className="space-y-3" aria-busy="true">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-16 w-full" />
							<Skeleton className="h-9 w-full" />
						</ActionPanelBody>
					) : (
						<ProjectTemplateForm
							key={`${template.id}:${template.updatedAt.toString()}`}
							organizationId={organizationId}
							template={template}
							onCancel={() => onOpenChange(false)}
							onSaved={onSaved}
						/>
					))}
			</ActionPanelContent>
		</ActionPanel>
	);
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------

function TemplateRowActions({
	template,
	onEdit,
	onDeleted,
}: {
	template: ProjectTemplateSummary;
	onEdit: () => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslate();
	const [confirming, setConfirming] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	async function remove() {
		setIsDeleting(true);
		const result = await deleteProjectTemplate(template.id).catch(() => null);
		setIsDeleting(false);
		if (result?.success) {
			toast.success(
				t("settings.projects.templates.deleted", "{name} deleted", { name: template.name }),
			);
			setConfirming(false);
			onDeleted();
			return;
		}
		toast.error(
			result?.error ||
				t("settings.projects.templates.deleteFailed", "Failed to delete {name}", {
					name: template.name,
				}),
		);
	}

	if (confirming) {
		return (
			<InlineDeleteConfirm
				className="justify-end"
				question={t("settings.projects.templates.deleteQuestion", "Delete this template?")}
				confirmLabel={t("settings.projects.templates.confirmDelete", "Confirm deleting {name}", {
					name: template.name,
				})}
				deleteText={t("settings.projects.templates.delete", "Delete")}
				isDeleting={isDeleting}
				onCancel={() => setConfirming(false)}
				onConfirm={remove}
			/>
		);
	}

	return (
		<div className="flex items-center justify-end gap-1">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-8"
				aria-label={t("settings.projects.templates.editAction", "Edit {name}", {
					name: template.name,
				})}
				onClick={onEdit}
			>
				<IconEdit className="size-4" aria-hidden="true" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-8"
				aria-label={t("settings.projects.templates.deleteAction", "Delete {name}", {
					name: template.name,
				})}
				onClick={() => setConfirming(true)}
			>
				<IconTrash className="size-4" aria-hidden="true" />
			</Button>
		</div>
	);
}

export function ProjectTemplateManagement({ organizationId }: { organizationId: string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const {
		data: templates = [],
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.projects.templates(organizationId),
		queryFn: async () => {
			const result = await getProjectTemplates();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const hours = useMemo(
		() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
		[locale],
	);

	function refresh() {
		queryClient.invalidateQueries({ queryKey: queryKeys.projects.templates(organizationId) });
		if (editingId) {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.templateDetail(editingId) });
		}
	}

	function openEditor(templateId: string | null) {
		setEditingId(templateId);
		setDialogOpen(true);
	}

	const createButton = (
		<Button onClick={() => openEditor(null)}>
			<IconPlus className="size-4" aria-hidden="true" />
			{t("settings.projects.templates.create", "Create template")}
		</Button>
	);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-col gap-2">
					<h2 className="text-2xl font-semibold tracking-tight">
						{t("settings.projects.templates.title", "Project templates")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.projects.templates.description",
							"Blueprints for new projects: tasks, budget, deadline, managers and members.",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
					{createButton}
				</div>
			</div>

			{isLoading ? (
				<Card aria-busy="true">
					<CardHeader className="space-y-2">
						<Skeleton className="h-6 w-40" />
					</CardHeader>
					<CardContent className="space-y-4">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</CardContent>
				</Card>
			) : templates.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12 text-center">
						<IconTemplate className="size-12 text-muted-foreground" aria-hidden="true" />
						<h3 className="mt-4 text-lg font-medium">
							{t("settings.projects.templates.empty.title", "No templates yet")}
						</h3>
						<p className="mt-2 max-w-md text-sm text-muted-foreground">
							{t(
								"settings.projects.templates.empty.description",
								"Save the tasks, budget and people you set up for every similar project once, and start new projects from it.",
							)}
						</p>
						<div className="mt-4">{createButton}</div>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.projects.templates.listTitle", "All templates")}</CardTitle>
						<CardDescription>
							{t(
								"settings.projects.templates.listCount",
								"{count, plural, one {# template} other {# templates}}",
								{ count: templates.length },
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.projects.templates.column.name", "Name")}</TableHead>
									<TableHead>{t("settings.projects.templates.column.tasks", "Tasks")}</TableHead>
									<TableHead>{t("settings.projects.templates.column.budget", "Budget")}</TableHead>
									<TableHead>
										{t("settings.projects.templates.column.deadline", "Deadline")}
									</TableHead>
									<TableHead>{t("settings.projects.templates.column.people", "People")}</TableHead>
									<TableHead className="w-[120px]">
										<span className="sr-only">
											{t("settings.projects.templates.column.actions", "Actions")}
										</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{templates.map((template) => (
									<TableRow key={template.id}>
										<TableCell>
											<div className="flex items-center gap-2">
												{template.color && (
													<span
														className="size-4 shrink-0 rounded-full"
														style={{ backgroundColor: template.color }}
														aria-hidden="true"
													/>
												)}
												<TemplateIcon
													icon={template.icon}
													className="size-4 shrink-0 text-muted-foreground"
												/>
												<div className="min-w-0">
													<div className="font-medium">{template.name}</div>
													{template.description && (
														<div className="line-clamp-1 text-sm text-muted-foreground">
															{template.description}
														</div>
													)}
												</div>
											</div>
										</TableCell>
										<TableCell>
											{t(
												"settings.projects.templates.taskCount",
												"{count, plural, one {# task} other {# tasks}}",
												{ count: template.taskCount },
											)}
										</TableCell>
										<TableCell>
											{template.budgetHours ? (
												t("settings.projects.templates.budgetHours", "{hours} h", {
													hours: hours.format(Number(template.budgetHours)),
												})
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{template.deadlineOffsetDays === null ? (
												<span className="text-muted-foreground">-</span>
											) : template.deadlineOffsetDays === 0 ? (
												t("settings.projects.templates.deadlineSameDay", "On the day of creation")
											) : (
												t(
													"settings.projects.templates.deadlineOffset",
													"{count, plural, one {# day after creation} other {# days after creation}}",
													{ count: template.deadlineOffsetDays },
												)
											)}
										</TableCell>
										<TableCell>
											{t(
												"settings.projects.templates.peopleCount",
												"{count, plural, one {# person or team} other {# people and teams}}",
												{ count: template.managerCount + template.assignmentCount },
											)}
										</TableCell>
										<TableCell>
											<TemplateRowActions
												template={template}
												onEdit={() => openEditor(template.id)}
												onDeleted={refresh}
											/>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			<ProjectTemplateDialog
				organizationId={organizationId}
				templateId={editingId}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSaved={() => {
					refresh();
					setDialogOpen(false);
				}}
			/>
		</div>
	);
}
