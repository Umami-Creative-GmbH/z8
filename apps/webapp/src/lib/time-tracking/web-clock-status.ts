import { z } from "zod";
import {
	PROJECT_TASK_STATES,
	type BookedProjectTask,
} from "@/lib/projects/project-task-model";

export const WEB_CLOCK_STATUS_UNAVAILABLE = "Clock status is unavailable.";
export interface WebClockStatus {
	hasEmployee: boolean;
	employeeId: string | null;
	isClockedIn: boolean;
	activeWorkPeriod: {
		id: string;
		startTime: Date;
		currentTask: BookedProjectTask | null;
		breakStartedAt: Date | null;
		breakStartedZone: string | null;
	} | null;
}
// Date conversion is confined to this HTTP boundary; all values are UTC instants.
const instant = z.string().refine((value) => {
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value;
});
const task = z
	.object({
		id: z.string().min(1),
		name: z.string(),
		state: z.enum(PROJECT_TASK_STATES),
		projectId: z.string().min(1),
	})
	.strict();
const wire = z
	.object({
		hasEmployee: z.boolean(),
		employeeId: z.string().min(1).nullable(),
		isClockedIn: z.boolean(),
		activeWorkPeriod: z
			.object({
				id: z.string().min(1),
				startTime: instant,
				currentTask: task.nullable(),
				breakStartedAt: instant.nullable(),
				breakStartedZone: z.string().nullable(),
			})
			.strict()
			.nullable(),
	})
	.strict()
	.refine((value) =>
		value.hasEmployee
			? value.employeeId !== null &&
				value.isClockedIn === (value.activeWorkPeriod !== null)
			: value.employeeId === null &&
				!value.isClockedIn &&
				value.activeWorkPeriod === null,
	);
export type WebClockStatusWire = z.infer<typeof wire>;
function dateToWire(value: Date) {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
		throw Error();
	return value.toISOString();
}
export function serializeWebClockStatus(
	value: WebClockStatus,
): WebClockStatusWire {
	try {
		return wire.parse({
			...value,
			activeWorkPeriod: value.activeWorkPeriod
				? {
						...value.activeWorkPeriod,
						startTime: dateToWire(value.activeWorkPeriod.startTime),
						breakStartedAt:
							value.activeWorkPeriod.breakStartedAt === null
								? null
								: dateToWire(value.activeWorkPeriod.breakStartedAt),
					}
				: null,
		});
	} catch {
		throw new Error(WEB_CLOCK_STATUS_UNAVAILABLE);
	}
}
export function parseWebClockStatus(value: unknown): WebClockStatus {
	try {
		const parsed = wire.parse(value);
		return {
			...parsed,
			activeWorkPeriod: parsed.activeWorkPeriod
				? {
						...parsed.activeWorkPeriod,
						startTime: new Date(parsed.activeWorkPeriod.startTime),
						breakStartedAt:
							parsed.activeWorkPeriod.breakStartedAt === null
								? null
								: new Date(parsed.activeWorkPeriod.breakStartedAt),
					}
				: null,
		};
	} catch {
		throw new Error(WEB_CLOCK_STATUS_UNAVAILABLE);
	}
}
