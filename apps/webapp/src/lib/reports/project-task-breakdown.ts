import type { ProjectTask } from "@/lib/projects/project-task-model";
import type { ProjectTaskBreakdownRow } from "./project-types";

type BreakdownTask = Pick<ProjectTask, "id" | "name" | "state" | "estimateHours">;

/**
 * The project report's "By task" section (#876), built from the same work
 * periods as the report's summary, so its rows add up to the summary total.
 * Time without a task is one "No task" row, listed last. Task rows are ordered
 * by booked time, then name.
 *
 * `bookedMinutesToDate` holds every minute ever booked to a task; estimate
 * progress compares that with the task estimate.
 */
export function buildProjectTaskBreakdown(input: {
	periods: ReadonlyArray<{ taskId: string | null; durationMinutes: number | null }>;
	tasks: ReadonlyArray<BreakdownTask>;
	bookedMinutesToDate: ReadonlyMap<string, number>;
}): ProjectTaskBreakdownRow[] {
	const totals = new Map<string | null, { minutes: number; count: number }>();
	let totalMinutes = 0;
	for (const period of input.periods) {
		const minutes = period.durationMinutes ?? 0;
		const entry = totals.get(period.taskId) ?? { minutes: 0, count: 0 };
		entry.minutes += minutes;
		entry.count += 1;
		totals.set(period.taskId, entry);
		totalMinutes += minutes;
	}

	const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
	const row = (
		taskId: string | null,
		stats: { minutes: number; count: number },
	): ProjectTaskBreakdownRow => {
		const task = taskId ? tasksById.get(taskId) : undefined;
		const estimateHours = task?.estimateHours ? Number(task.estimateHours) : null;
		const bookedHours = taskId ? (input.bookedMinutesToDate.get(taskId) ?? 0) / 60 : 0;
		return {
			taskId,
			taskName: task?.name ?? null,
			state: task?.state ?? null,
			totalMinutes: stats.minutes,
			totalHours: stats.minutes / 60,
			workPeriodCount: stats.count,
			percentOfTotal: totalMinutes > 0 ? (stats.minutes / totalMinutes) * 100 : 0,
			estimate:
				estimateHours !== null
					? { estimateHours, bookedHours, percentUsed: (bookedHours / estimateHours) * 100 }
					: null,
		};
	};

	const taskRows = [...totals.entries()]
		.filter((entry): entry is [string, { minutes: number; count: number }] => entry[0] !== null)
		.map(([taskId, stats]) => row(taskId, stats))
		.sort(
			(a, b) =>
				b.totalMinutes - a.totalMinutes || (a.taskName ?? "").localeCompare(b.taskName ?? ""),
		);
	const untasked = totals.get(null);
	return untasked ? [...taskRows, row(null, untasked)] : taskRows;
}
