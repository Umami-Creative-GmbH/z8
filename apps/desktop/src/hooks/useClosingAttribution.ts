import { useForm } from "@tanstack/react-form";
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
 * tells whether the work's current task can survive the close; `keptTask` is
 * that task (#930): null when there is none to keep, undefined when an older
 * server does not say. A context from a server without tasks, or one where
 * projects are unavailable, offers none, so no task is ever sent to it.
 */
export function offeredTasks(
	context: DesktopContext | undefined,
	projectValue: string,
): {
	tasks: ProjectTask[];
	keepsProject: boolean;
	keptTask: ProjectTask | null | undefined;
} {
	if (!attributionAvailability(context).project)
		return { tasks: [], keepsProject: false, keptTask: null };
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
	const keepsProject = !!projectId && projectId === current;
	return {
		tasks: project?.tasks ?? [],
		keepsProject,
		keptTask: keepsProject ? context?.liveWork?.task : null,
	};
}

export function useClosingAttribution(context?: DesktopContext) {
	const form = useForm({
		// task "" sends no task: it follows the project on the server.
		defaultValues: { project: "preserve", workCategory: "preserve", task: "" },
	});
	return {
		form,
		value: (
			current: DesktopContext | undefined = context,
		): ClosingAttribution => {
			const available = attributionAvailability(current);
			const { project, workCategory, task } = form.state.values;
			const offered = offeredTasks(current, project);
			const chosen =
				(task === "clear" &&
					offered.keepsProject &&
					offered.keptTask !== null &&
					offered.tasks.length > 0) ||
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
