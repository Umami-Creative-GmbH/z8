import { z } from "zod";
import {
	type AssignmentFilters,
	type AssignmentStatusView,
	DEFAULT_ASSIGNMENT_FILTERS,
	type FormerView,
} from "./equipment-list";

/**
 * The overview's filters in its URL (#1572). The parameters keep the equipment
 * filter schema (`holderId`, `typeId`, `outstanding`, `overdue`, `former`), so
 * reminder links such as `/equipment?holderId=…&outstanding=true` still open the
 * holder's outstanding returns. Without a parameter the list shows outstanding
 * returns; `status=all` and `status=soon` (due within 14 days) are the one addition,
 * because "all" is no longer the default.
 * The free-text search stays out of the URL.
 */
export type EquipmentListQuery = Omit<AssignmentFilters, "search">;

type QueryInput =
	| URLSearchParams
	| Record<string, string | string[] | undefined>;

function read(input: QueryInput, key: string) {
	const value = input instanceof URLSearchParams ? input.get(key) : input[key];
	return (Array.isArray(value) ? value[0] : value) ?? undefined;
}

const reference = z.uuid();
function readReference(input: QueryInput, key: string) {
	const parsed = reference.safeParse(read(input, key));
	return parsed.success ? parsed.data : null;
}

export function parseEquipmentListQuery(input: QueryInput): EquipmentListQuery {
	const overdue = read(input, "overdue");
	const outstanding = read(input, "outstanding");
	const view = read(input, "status");
	const status: AssignmentStatusView =
		overdue === "true"
			? "overdue"
			: view === "soon"
				? "soon"
				: view === "all" || outstanding === "false" || overdue === "false"
					? "all"
					: "outstanding";
	const formerParam = read(input, "former");
	const former: FormerView =
		formerParam === "false" ? "hide" : formerParam === "true" ? "only" : "show";
	return {
		status,
		holderId: readReference(input, "holderId"),
		typeId: readReference(input, "typeId"),
		former,
	};
}

/** The query string for a list state, empty for the default view. */
export function equipmentListSearch(query: EquipmentListQuery) {
	const params = new URLSearchParams();
	if (query.holderId) params.set("holderId", query.holderId);
	if (query.typeId) params.set("typeId", query.typeId);
	if (query.status === "overdue") params.set("overdue", "true");
	if (query.status === "all" || query.status === "soon")
		params.set("status", query.status);
	if (query.former === "hide") params.set("former", "false");
	if (query.former === "only") params.set("former", "true");
	return params.toString();
}

export function equipmentListHref(query: EquipmentListQuery) {
	const search = equipmentListSearch(query);
	return search ? `/equipment?${search}` : "/equipment";
}

export const DEFAULT_EQUIPMENT_LIST_QUERY: EquipmentListQuery = {
	status: DEFAULT_ASSIGNMENT_FILTERS.status,
	holderId: DEFAULT_ASSIGNMENT_FILTERS.holderId,
	typeId: DEFAULT_ASSIGNMENT_FILTERS.typeId,
	former: DEFAULT_ASSIGNMENT_FILTERS.former,
};

const RETURN_PATH =
	/^\/equipment(?:\/employees\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?:\?[\w=&%.-]*)?$/i;

/**
 * Where an assignment page leads back to: the list it was opened from, with its
 * filters. Anything but the overview or an employee's equipment falls back to the overview.
 */
export function equipmentReturnPath(value: string | string[] | undefined) {
	const path = Array.isArray(value) ? value[0] : value;
	return path && RETURN_PATH.test(path) ? path : "/equipment";
}

export function assignmentHref(assignmentId: string, back?: string) {
	const path = `/equipment/assignments/${assignmentId}`;
	return back && back !== "/equipment"
		? `${path}?${new URLSearchParams({ back })}`
		: path;
}
