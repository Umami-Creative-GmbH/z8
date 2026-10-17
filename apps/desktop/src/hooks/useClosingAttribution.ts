import { useForm, useStore } from "@tanstack/react-form";
import { attributionAvailability } from "../lib/attribution-availability";
import type {
	AttributionIntent,
	ClosingAttribution,
	DesktopContext,
	ProjectTask,
} from "../types";

function intent(value: string): AttributionIntent {
	if (value === "preserve") return { kind: "preserve" };
	if (value === "clear") return { kind: "clear" };
	return { kind: "replace", id: value };
}

/**
 * The open tasks offered for the project the closing work will have (#882):
 * the chosen project, or the current one while it is kept. `keepsProject`
 * tells whether the work's current task can survive the close. A context from
 * a server without tasks, or one where projects are unavailable, offers none,
 * so no task is ever sent to it.
 */
export function offeredTasks(
	context: DesktopContext | undefined,
	projectValue: string,
): { tasks: ProjectTask[]; keepsProject: boolean; taskRequired: boolean } {
	if (!attributionAvailability(context).project)
		return { tasks: [], keepsProject: false, taskRequired: false };
	const current = context?.liveWork?.projectId ?? null;
	const projectId =
		projectValue === "preserve"
			? current
			: projectValue === "clear"
				? null
				: projectValue;
	const project = projectId
		? context?.projects.find((candidate) => candidate.id === projectId)
		: undefined;
	const tasks = project?.tasks ?? [];
	return {
		tasks,
		keepsProject: !!projectId && projectId === current,
		// The server flags only a project with an open task (#1297); without one
		// to pick, nothing is required.
		taskRequired: project?.taskRequired === true && tasks.length > 0,
	};
}

/**
 * Whether the closing work would end without a task on a project that
 * requires one (#1297): no offered open task is picked, and the running
 * work's task is not kept. The picker is desktop's only check for it.
 */
export function taskMissing(
	context: DesktopContext | undefined,
	values: { project: string; task: string },
): boolean {
	const offered = offeredTasks(context, values.project);
	if (!offered.taskRequired) return false;
	if (offered.tasks.some((candidate) => candidate.id === values.task))
		return false;
	const keepsCurrentTask =
		values.task === "" &&
		offered.keepsProject &&
		!!context?.liveWork?.currentTask;
	return !keepsCurrentTask;
}

export function useClosingAttribution(context?: DesktopContext) {
	const form = useForm({
		// task "" sends no task: it follows the project on the server.
		defaultValues: { project: "preserve", workCategory: "preserve", task: "" },
	});
	const missing = useStore(form.store, (state) =>
		taskMissing(context, state.values),
	);
	return {
		form,
		/** True while the clock-out must wait for a task (#1297). */
		taskMissing: missing,
		value: (
			current: DesktopContext | undefined = context,
		): ClosingAttribution => {
			const available = attributionAvailability(current);
			const { project, workCategory, task } = form.state.values;
			const offered = offeredTasks(current, project);
			const chosen =
				(task === "clear" &&
					offered.keepsProject &&
					(offered.tasks.length > 0 || !!current?.liveWork?.currentTask)) ||
				offered.tasks.some((candidate) => candidate.id === task);
			return {
				project: available.project ? intent(project) : { kind: "preserve" },
				workCategory: available.workCategory
					? intent(workCategory)
					: { kind: "preserve" },
				...(chosen ? { task: intent(task) } : {}),
			};
		},
	};
}
