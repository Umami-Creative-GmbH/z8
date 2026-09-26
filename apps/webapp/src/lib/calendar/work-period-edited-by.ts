import { Temporal } from "temporal-polyfill";

export interface WorkPeriodEndpointEdit {
	/** Time entry type of the endpoint that now bounds the work period. */
	type: string;
	createdBy: string | null;
	createdAt: Date;
	editorName: string | null;
}

export interface WorkPeriodEditedBy {
	editedByName: string;
	editedAt: Date;
}

/**
 * Who last edited a work period on the employee's behalf (#507). An applied
 * correction becomes the period's endpoint, so the newest correction endpoint
 * names the last edit. Only edits by someone other than the employee count.
 */
export function resolveWorkPeriodEditedBy(input: {
	ownerUserId: string;
	endpoints: Array<WorkPeriodEndpointEdit | null>;
}): WorkPeriodEditedBy | null {
	let latest: WorkPeriodEndpointEdit | null = null;
	for (const endpoint of input.endpoints) {
		if (endpoint?.type !== "correction") continue;
		if (!latest || endpoint.createdAt.getTime() > latest.createdAt.getTime()) {
			latest = endpoint;
		}
	}
	if (!latest?.createdBy || latest.createdBy === input.ownerUserId || !latest.editorName) {
		return null;
	}
	return { editedByName: latest.editorName, editedAt: latest.createdAt };
}

/** The edit date as `dd.mm.yyyy` in the calendar's timezone. */
export function formatWorkPeriodEditedDate(editedAt: Date | string, timeZone: string): string {
	const date = Temporal.Instant.fromEpochMilliseconds(new Date(editedAt).getTime())
		.toZonedDateTimeISO(timeZone)
		.toPlainDate();
	const day = String(date.day).padStart(2, "0");
	const month = String(date.month).padStart(2, "0");
	return `${day}.${month}.${String(date.year).padStart(4, "0")}`;
}
