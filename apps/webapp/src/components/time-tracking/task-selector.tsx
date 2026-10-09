"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import type { BookedProjectTask, ProjectTaskChoice } from "@/lib/projects/project-task-model";

/** The task a booking already carries; it may be done by now (#874). */
export type BookingTask = BookedProjectTask;

interface TaskSelectorViewProps {
	/** The chosen project. Without one there is no task to choose. */
	projectId: string | undefined;
	/** Bookable projects with their open tasks, as the project choices carry them. */
	projects: ReadonlyArray<{ id: string; tasks: readonly ProjectTaskChoice[] }>;
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
 * Optional task picker for booking surfaces (#874). It lists only the open tasks
 * of the chosen project and renders nothing for a project without any.
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
	const label = t("timeTracking.taskPicker.label", "Task");
	const noTask = t("timeTracking.taskPicker.none", "No task");
	const doneSuffix = t("timeTracking.taskPicker.doneSuffix", "(done)");

	if (!projectId) return null;

	const openTasks = projects.find((project) => project.id === projectId)?.tasks ?? [];
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
			name: currentTask.state === "done" ? `${currentTask.name} ${doneSuffix}` : currentTask.name,
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
				options={options}
				value={value ?? ""}
				onValueChange={(next) => onValueChange(next === "" ? undefined : next)}
				placeholder={noTask}
				searchPlaceholder={t("timeTracking.taskPicker.search", "Search tasks…")}
				emptyText={t("timeTracking.taskPicker.empty", "No task found")}
				allowEmpty
				emptyLabel={noTask}
				disabled={disabled}
			/>
		</div>
	);
}
