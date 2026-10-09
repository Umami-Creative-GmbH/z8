import { useForm } from "@tanstack/react-form";
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
 * a server without tasks offers none, so no task is ever sent to it.
 */
export function offeredTasks(
	context: DesktopContext | undefined,
	projectValue: string,
): { tasks: ProjectTask[]; keepsProject: boolean } {
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
	return {
		tasks: project?.tasks ?? [],
		keepsProject: !!projectId && projectId === current,
	};
}

export function useClosingAttribution() {
	const form = useForm({
		// task "" sends no task: it follows the project on the server.
		defaultValues: { project: "preserve", workCategory: "preserve", task: "" },
	});
	return {
		form,
		value: (context: DesktopContext | undefined): ClosingAttribution => {
			const { project, workCategory, task } = form.state.values;
			const offered = offeredTasks(context, project);
			const chosen =
				(task === "clear" &&
					offered.keepsProject &&
					offered.tasks.length > 0) ||
				offered.tasks.some((candidate) => candidate.id === task);
			return {
				project: intent(project),
				workCategory: intent(workCategory),
				...(chosen ? { task: intent(task) } : {}),
			};
		},
	};
}
