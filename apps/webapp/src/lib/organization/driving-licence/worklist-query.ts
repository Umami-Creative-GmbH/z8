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

/** The Checks table's sortable columns (#1418): soonest deadline first by default. */
export const DRIVING_LICENCE_WORKLIST_SORTS = ["deadline", "name", "team"] as const;
export type DrivingLicenceWorklistSort = (typeof DRIVING_LICENCE_WORKLIST_SORTS)[number];
export type DrivingLicenceWorklistDirection = "asc" | "desc";

export const drivingLicenceWorklistQuery = z
	.strictObject({
		search: z.string().trim().max(100).optional(),
		status: z.enum(DRIVING_LICENCE_WORKLIST_STATUSES).optional(),
		sort: z.enum(DRIVING_LICENCE_WORKLIST_SORTS).optional(),
		direction: z.enum(["asc", "desc"]).optional(),
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
type SortableRow = {
	name: string;
	employeeId: string;
	status: AuthorizationStatus;
	nextDeadline: DrivingLicenceNextDeadline | null;
	team?: { name: string } | null;
};
function compareByDeadline(left: SortableRow, right: SortableRow) {
	return (
		urgency(left) - urgency(right) ||
		(left.nextDeadline && right.nextDeadline
			? compareInstants(
					parseInstant(left.nextDeadline.expiresAt),
					parseInstant(right.nextDeadline.expiresAt),
				)
			: 0)
	);
}
/** Employees without a primary team come last in either direction. */
function compareByTeam(left: SortableRow, right: SortableRow) {
	if (!left.team || !right.team) return left.team ? -1 : right.team ? 1 : 0;
	return left.team.name.localeCompare(right.team.name);
}
/**
 * Orders the Checks table on the server. `deadline` (the default): checks due now, then the
 * soonest next deadline, then ended records. Ties go by name, then id, ascending.
 */
export function sortDrivingLicenceWorklist<Row extends SortableRow>(
	rows: readonly Row[],
	order: { sort?: DrivingLicenceWorklistSort; direction?: DrivingLicenceWorklistDirection } = {},
): Row[] {
	const sort = order.sort ?? "deadline";
	const sign = order.direction === "desc" ? -1 : 1;
	const tieBreak = (left: Row, right: Row) =>
		left.name.localeCompare(right.name) || left.employeeId.localeCompare(right.employeeId);
	return [...rows].sort((left, right) => {
		if (sort === "team") {
			const missing = !left.team || !right.team;
			const byTeam = compareByTeam(left, right);
			return (missing ? byTeam : sign * byTeam) || tieBreak(left, right);
		}
		const primary =
			sort === "name"
				? tieBreak(left, right)
				: compareByDeadline(left, right) || tieBreak(left, right);
		return sign * primary;
	});
}
