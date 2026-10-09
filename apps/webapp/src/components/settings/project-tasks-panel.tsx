"use client";

import {
	IconCheck,
	IconEdit,
	IconListCheck,
	IconLoader2,
	IconPlus,
	IconRotate,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	createProjectTask,
	deleteProjectTask,
	getProjectTasks,
	markProjectTaskDone,
	reopenProjectTask,
	updateProjectTask,
} from "@/app/[locale]/(app)/settings/projects/task-actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	PROJECT_TASK_DESCRIPTION_MAX_LENGTH,
	type ProjectTask,
} from "@/lib/projects/project-task-model";
import { queryKeys } from "@/lib/query";
import { InlineDeleteConfirm } from "./inline-delete-confirm";
import {
	hoursFormText,
	hoursFromFormText,
	PROJECT_TASK_ESTIMATE_INPUT,
	PROJECT_TASK_NAME_INPUT,
	useProjectTaskFieldRules,
} from "./project-task-fields";

interface ProjectTasksPanelProps {
	project: { id: string; name: string } | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface TaskFormValues {
	name: string;
	description: string;
	estimateHours: string;
}

interface TaskFormSubmission {
	name: string;
	description: string | null;
	estimateHours: number | null;
}

const EMPTY_TASK: TaskFormValues = { name: "", description: "", estimateHours: "" };

function toSubmission(values: TaskFormValues): TaskFormSubmission {
	return {
		name: values.name.trim(),
		description: values.description.trim() || null,
		estimateHours: hoursFromFormText(values.estimateHours),
	};
}

/** Create and edit share one form; `onSubmit` resolves whether the task was saved. */
function TaskForm({
	label,
	initialValues,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	label: string;
	initialValues: TaskFormValues;
	submitLabel: string;
	onSubmit: (task: TaskFormSubmission) => Promise<boolean>;
	onCancel?: () => void;
}) {
	const { t } = useTranslate();
	const rules = useProjectTaskFieldRules();
	const form = useForm({
		defaultValues: initialValues,
		onSubmit: async ({ value, formApi }) => {
			const saved = await onSubmit(toSubmission(value));
			if (saved && !onCancel) formApi.reset();
		},
	});

	return (
		// TanStack Form owns the submission lifecycle; see .react-doctor/false-positives.md.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			aria-label={label}
			className="grid gap-3"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.Field
				name="name"
				validators={{ onSubmit: rules.name }}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("settings.projects.tasks.field.name", "Name")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								value={field.state.value}
								{...PROJECT_TASK_NAME_INPUT}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t("settings.projects.tasks.field.namePlaceholder", "e.g., Design")}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="description">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("settings.projects.tasks.field.description", "Description")}</TFormLabel>
						<TFormControl>
							<Textarea
								value={field.state.value}
								maxLength={PROJECT_TASK_DESCRIPTION_MAX_LENGTH}
								rows={2}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="estimateHours"
				validators={{ onSubmit: rules.estimate }}

			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.projects.tasks.field.estimate", "Estimate (hours)")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								{...PROJECT_TASK_ESTIMATE_INPUT}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<div className="flex justify-end gap-2">
						{onCancel && (
							<Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
								{t("common.cancel", "Cancel")}
							</Button>
						)}
						<Button
							type="submit"
							variant={onCancel ? "default" : "outline"}
							disabled={isSubmitting}
						>
							{isSubmitting ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : (
								!onCancel && <IconPlus className="size-4" aria-hidden="true" />
							)}
							{submitLabel}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}

function TaskRow({ task, onChanged }: { task: ProjectTask; onChanged: () => void }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
	const [isBusy, setIsBusy] = useState(false);
	const isDone = task.state === "done";

	async function run(
		request: () => Promise<ServerActionResult<void>>,
		messages: { success: string; failure: string },
	) {
		setIsBusy(true);
		const result = await request().catch(() => null);
		setIsBusy(false);
		if (result?.success) {
			toast.success(messages.success);
			onChanged();
			return true;
		}
		toast.error(result?.error || messages.failure);
		return false;
	}

	if (mode === "edit") {
		return (
			<li className="px-3 py-3">
				<TaskForm
					label={t("settings.projects.tasks.edit", "Edit {name}", { name: task.name })}
					initialValues={{
						name: task.name,
						description: task.description ?? "",
						estimateHours: hoursFormText(task.estimateHours),
					}}
					submitLabel={t("settings.projects.tasks.save", "Save")}
					onCancel={() => setMode("view")}
					onSubmit={async (values) => {
						const saved = await run(() => updateProjectTask(task.id, values), {
							success: t("settings.projects.tasks.updated", "Task updated"),
							failure: t("settings.projects.tasks.updateFailed", "Failed to update task"),
						});
						if (saved) setMode("view");
						return saved;
					}}
				/>
			</li>
		);
	}

	const estimate = task.estimateHours
		? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(task.estimateHours))
		: null;

	return (
		<li className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-0.5">
				<div className="flex flex-wrap items-center gap-2">
					<span className={isDone ? "font-medium text-muted-foreground" : "font-medium"}>
						{task.name}
					</span>
					{isDone && (
						<Badge variant="secondary">{t("settings.projects.tasks.stateDone", "Done")}</Badge>
					)}
				</div>
				{task.description && (
					<p className="text-muted-foreground line-clamp-2">{task.description}</p>
				)}
				{estimate && (
					<p className="text-xs text-muted-foreground">
						{t("settings.projects.tasks.estimate", "Estimate: {hours} h", { hours: estimate })}
					</p>
				)}
			</div>
			{mode === "confirmDelete" ? (
				<InlineDeleteConfirm
					className="shrink-0"
					question={t("settings.projects.tasks.deleteQuestion", "Delete this task?")}
					confirmLabel={t("settings.projects.tasks.confirmDelete", "Confirm deleting {name}", {
						name: task.name,
					})}
					deleteText={t("settings.projects.tasks.delete", "Delete")}
					isDeleting={isBusy}
					onCancel={() => setMode("view")}
					onConfirm={() =>
						run(() => deleteProjectTask(task.id), {
							success: t("settings.projects.tasks.deleted", "{name} deleted", {
								name: task.name,
							}),
							failure: t("settings.projects.tasks.deleteFailed", "Failed to delete {name}", {
								name: task.name,
							}),
						})
					}
				/>
			) : (
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-8"
						disabled={isBusy}
						aria-label={t("settings.projects.tasks.editAction", "Edit {name}", { name: task.name })}
						onClick={() => setMode("edit")}
					>
						<IconEdit className="size-4" aria-hidden="true" />
					</Button>
					{isDone ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-8"
							disabled={isBusy}
							aria-label={t("settings.projects.tasks.reopen", "Reopen {name}", { name: task.name })}
							onClick={() =>
								run(() => reopenProjectTask(task.id), {
									success: t("settings.projects.tasks.reopened", "Task reopened"),
									failure: t("settings.projects.tasks.reopenFailed", "Failed to reopen task"),
								})
							}
						>
							<IconRotate className="size-4" aria-hidden="true" />
						</Button>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-8"
							disabled={isBusy}
							aria-label={t("settings.projects.tasks.markDone", "Mark {name} done", {
								name: task.name,
							})}
							onClick={() =>
								run(() => markProjectTaskDone(task.id), {
									success: t("settings.projects.tasks.markedDone", "Task marked done"),
									failure: t("settings.projects.tasks.markDoneFailed", "Failed to mark task done"),
								})
							}
						>
							<IconCheck className="size-4" aria-hidden="true" />
						</Button>
					)}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-8"
						disabled={isBusy}
						aria-label={t("settings.projects.tasks.deleteAction", "Delete {name}", {
							name: task.name,
						})}
						onClick={() => setMode("confirmDelete")}
					>
						<IconTrash className="size-4" aria-hidden="true" />
					</Button>
				</div>
			)}
		</li>
	);
}

export function ProjectTasksPanel({ project, open, onOpenChange }: ProjectTasksPanelProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const listHeadingId = useId();
	const projectId = project?.id ?? "";

	const { data: tasks = [], isLoading } = useQuery({
		queryKey: queryKeys.projects.tasks(projectId),
		queryFn: async () => {
			const result = await getProjectTasks(projectId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && projectId !== "",
	});

	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.projects.tasks.title", "Tasks")}</ActionPanelTitle>
					<ActionPanelDescription>{project?.name}</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-6">
					{project && (
						<section className="space-y-3">
							<h3 className="text-sm font-medium">
								{t("settings.projects.tasks.addTitle", "Add a task")}
							</h3>
							<TaskForm
								label={t("settings.projects.tasks.addTitle", "Add a task")}
								initialValues={EMPTY_TASK}
								submitLabel={t("settings.projects.tasks.add", "Add task")}
								onSubmit={async (values) => {
									const result = await createProjectTask({
										projectId: project.id,
										...values,
									}).catch(() => null);
									if (result?.success) {
										toast.success(t("settings.projects.tasks.added", "Task added"));
										refresh();
										return true;
									}
									toast.error(
										result?.error || t("settings.projects.tasks.addFailed", "Failed to add task"),
									);
									return false;
								}}
							/>
						</section>
					)}
					<section aria-labelledby={listHeadingId} className="space-y-3">
						<h3 id={listHeadingId} className="text-sm font-medium">
							{t("settings.projects.tasks.listTitle", "Project tasks")}
						</h3>
						{isLoading ? (
							<div className="space-y-2" aria-hidden="true">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						) : tasks.length === 0 ? (
							<div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-6 text-center">
								<IconListCheck className="size-6 text-muted-foreground" aria-hidden="true" />
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.projects.tasks.empty",
										"No tasks yet. Tasks let people say what in the project their time was spent on.",
									)}
								</p>
							</div>
						) : (
							<ul
								aria-label={t("settings.projects.tasks.listLabel", "Tasks of {name}", {
									name: project?.name ?? "",
								})}
								className="divide-y rounded-md border"
							>
								{tasks.map((task) => (
									<TaskRow key={task.id} task={task} onChanged={refresh} />
								))}
							</ul>
						)}
					</section>
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
