import { z } from "zod";
import { compareInstants, parseInstant } from "@/lib/datetime/temporal-core";
import type { AuthorizationStatus } from "./check-types";

/** The Checks table's status filter (#1428). Ended records show only without a filter. */
export const DRIVING_LICENCE_WORKLIST_STATUSES = [
	"not_yet_checked",
	"active",
	"partially_active",
	"suspended",
] as const satisfies readonly AuthorizationStatus[];
export type DrivingLicenceWorklistStatus = (typeof DRIVING_LICENCE_WORKLIST_STATUSES)[number];

export const drivingLicenceWorklistQuery = z
	.strictObject({
		search: z.string().trim().max(100).optional(),
		status: z.enum(DRIVING_LICENCE_WORKLIST_STATUSES).optional(),
	})
	.default({});
export type DrivingLicenceWorklistQuery = z.input<typeof drivingLicenceWorklistQuery>;

export interface DrivingLicenceNextDeadline {
	/** Last covered local day. */
	validThrough: string;
	timezone: string;
	/** Exclusive end instant (ISO). */
	expiresAt: string;
}

/** The next time an active class authorization lapses; null when no class is active. */
export function drivingLicenceNextDeadline(
	classes: readonly {
		status: string;
		validThrough: string;
		deadlineTimezone: string;
		expiresAt: string;
	}[],
): DrivingLicenceNextDeadline | null {
	let next: DrivingLicenceNextDeadline | null = null;
	for (const entry of classes) {
		if (entry.status !== "active") continue;
		if (!next || compareInstants(parseInstant(entry.expiresAt), parseInstant(next.expiresAt)) < 0)
			next = {
				validThrough: entry.validThrough,
				timezone: entry.deadlineTimezone,
				expiresAt: entry.expiresAt,
			};
	}
	return next;
}

/**
 * A check is due now when nothing is active and the record has not ended (not yet checked,
 * suspended). Those come first, then the soonest next deadline, then ended records.
 */
function urgency(row: {
	status: AuthorizationStatus;
	nextDeadline: DrivingLicenceNextDeadline | null;
}) {
	if (row.status === "ended") return 2;
	return row.nextDeadline ? 1 : 0;
}
export function sortDrivingLicenceWorklist<
	Row extends {
		name: string;
		employeeId: string;
		status: AuthorizationStatus;
		nextDeadline: DrivingLicenceNextDeadline | null;
	},
>(rows: readonly Row[]): Row[] {
	return [...rows].sort(
		(left, right) =>
			urgency(left) - urgency(right) ||
			(left.nextDeadline && right.nextDeadline
				? compareInstants(
						parseInstant(left.nextDeadline.expiresAt),
						parseInstant(right.nextDeadline.expiresAt),
					)
				: 0) ||
			left.name.localeCompare(right.name) ||
			left.employeeId.localeCompare(right.employeeId),
	);
}
