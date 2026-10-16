"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import type { BookedProjectTask, ProjectTaskChoice } from "@/lib/projects/project-task-model";
import { isTaskRequirementActive } from "@/lib/projects/task-requirement";

/** The task a booking already carries; it may be done by now (#874). */
export type BookingTask = BookedProjectTask;

interface TaskSelectorViewProps {
	/** The chosen project. Without one there is no task to choose. */
	projectId: string | undefined;
	/**
	 * Bookable projects with their open tasks, as the project choices carry them,
	 * and the project's task requirement setting (#884).
	 */
	projects: ReadonlyArray<{
		id: string;
		tasks: readonly ProjectTaskChoice[];
		requiresTask?: boolean;
	}>;
	value: string | undefined;
	onValueChange: (taskId: string | undefined) => void;
	/**
	 * The booking's current task. A done task stays visible while it is selected,
	 * but it is not offered again once another choice was made.
	 */
	currentTask?: BookingTask | null;
	disabled?: boolean;
	showLabel?: boolean;
}

/**
 * Task picker for booking surfaces (#874). It lists only the open tasks of the
 * chosen project and renders nothing for a project without any. A task is
 * optional unless the project's task requirement is active (#884): then the
 * picker is marked required and offers no "No task".
 */
export function TaskSelectorView({
	projectId,
	projects,
	value,
	onValueChange,
	currentTask,
	disabled = false,
	showLabel = true,
}: TaskSelectorViewProps) {
	const { t } = useTranslate();
	const triggerId = useId();
	if (!projectId) return null;

	const project = projects.find((choice) => choice.id === projectId);
	const openTasks = project?.tasks ?? [];
	const required = taskRequiredFor({ requiresTask: project?.requiresTask, tasks: openTasks });
	const label = required
		? t("timeTracking.taskPicker.requiredLabel", "Task (required)")
		: t("timeTracking.taskPicker.label", "Task");
	const noTask = t("timeTracking.taskPicker.none", "No task");
	const options: SearchableSelectOption[] = openTasks.map((task) => ({
		code: task.id,
		name: task.name,
	}));
	const keepsCurrentTask =
		currentTask &&
		currentTask.projectId === projectId &&
		currentTask.id === value &&
		!openTasks.some((task) => task.id === currentTask.id);
	if (keepsCurrentTask) {
		options.unshift({
			code: currentTask.id,
			name:
				currentTask.state === "done"
					? t("timeTracking.taskPicker.doneTask", "{name} (done)", { name: currentTask.name })
					: currentTask.name,
		});
	}

	if (options.length === 0) return null;

	return (
		<div className="grid gap-2">
			{showLabel ? (
				<Label htmlFor={triggerId} className="text-sm text-muted-foreground">
					{label}
				</Label>
			) : null}
			<SearchableSelect
				id={triggerId}
				aria-label={showLabel ? undefined : label}
				aria-required={required}
				options={options}
				value={value ?? ""}
				onValueChange={(next) => onValueChange(next === "" ? undefined : next)}
				placeholder={required ? t("timeTracking.taskPicker.choose", "Choose a task") : noTask}
				searchPlaceholder={t("timeTracking.taskPicker.search", "Search tasks…")}
				emptyText={t("timeTracking.taskPicker.empty", "No task found")}
				allowEmpty={!required}
				emptyLabel={noTask}
				disabled={disabled}
			/>
		</div>
	);
}

/**
 * Whether a booking on the project must name a task: its task requirement is
 * active (#884). The project choices carry its open tasks, so the rule reads them.
 */
export function taskRequiredFor(
	project: { requiresTask?: boolean; tasks: readonly unknown[] } | undefined,
): boolean {
	if (!project) return false;
	return isTaskRequirementActive({
		requiresTask: project.requiresTask ?? false,
		hasOpenTask: project.tasks.length > 0,
	});
}
