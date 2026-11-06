import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentReadinessItemView,
} from "@/lib/organization/equipment/contracts";

/**
 * Pure list logic of the equipment surfaces (#1572): KPI figures, filters, the
 * default order and the My equipment groups. Every date is an organization
 * calendar date; `today` is the read model's `today` in the organization's zone.
 */

/** "Due within 14 days" counts deadlines from today through today + 14. */
export const DUE_SOON_DAYS = 14;

type ListAssignment = Pick<
	EquipmentAssignmentView,
	| "id"
	| "identifier"
	| "typeId"
	| "typeName"
	| "employeeId"
	| "holderName"
	| "former"
	| "returnRequired"
	| "effectiveDeadline"
	| "outstanding"
	| "overdue"
	| "held"
> & { serialNumber?: string | null };

/** Calendar days from `today` to `date`; negative when `date` has passed. */
export function daysFrom(today: string, date: string) {
	return parsePlainDate(today).until(parsePlainDate(date), {
		largestUnit: "days",
	}).days;
}

export type AssignmentStatusKind =
	| "overdue"
	| "outstanding"
	| "keep"
	| "received"
	| "closed";

/** One label per assignment; physical receipt wins over the obligation's state. */
export function assignmentStatus(
	assignment: Pick<
		ListAssignment,
		"held" | "overdue" | "outstanding" | "returnRequired"
	>,
): AssignmentStatusKind {
	if (!assignment.held) return "received";
	if (assignment.overdue) return "overdue";
	if (assignment.outstanding) return "outstanding";
	return assignment.returnRequired ? "closed" : "keep";
}

export type DeadlineState =
	| { kind: "none" }
	| { kind: "overdue"; days: number }
	| { kind: "soon"; days: number }
	| { kind: "plain" };

/** How an effective return deadline reads today; only outstanding returns are urgent. */
export function deadlineState(
	assignment: Pick<
		ListAssignment,
		"effectiveDeadline" | "outstanding" | "overdue"
	>,
	today: string,
): DeadlineState {
	if (!assignment.effectiveDeadline) return { kind: "none" };
	if (!assignment.outstanding) return { kind: "plain" };
	const days = daysFrom(today, assignment.effectiveDeadline);
	if (assignment.overdue || days < 0)
		return { kind: "overdue", days: Math.max(1, -days) };
	if (days <= DUE_SOON_DAYS) return { kind: "soon", days };
	return { kind: "plain" };
}

export function isDueSoon(
	assignment: Pick<
		ListAssignment,
		"effectiveDeadline" | "outstanding" | "overdue"
	>,
	today: string,
) {
	return deadlineState(assignment, today).kind === "soon";
}

type ListItem = Pick<
	EquipmentReadinessItemView,
	"status" | "inCustody" | "archived" | "canProposeCustodyReceipt"
> & {
	custodyReceipt?: Pick<
		NonNullable<EquipmentReadinessItemView["custodyReceipt"]>,
		"confirmedAt"
	>;
};

/** Ready to issue: available, not held and not archived. */
export function isItemAvailable(item: ListItem) {
	return item.status === "available" && !item.inCustody && !item.archived;
}

export function hasPendingCustodyReceipt(item: ListItem) {
	return !!item.custodyReceipt && !item.custodyReceipt.confirmedAt;
}

/** Blocked from issue pending a decision, or a custody receipt still to propose or confirm. */
export function itemNeedsAttention(item: ListItem) {
	if (item.archived || item.status === "retired") return false;
	return (
		(item.status === "unavailable" && !item.inCustody) ||
		!!item.canProposeCustodyReceipt ||
		hasPendingCustodyReceipt(item)
	);
}

export type ItemView = "attention" | "available" | "held" | "all";
export const ITEM_VIEWS: readonly ItemView[] = [
	"attention",
	"available",
	"held",
	"all",
];

export function itemMatchesView(item: ListItem, view: ItemView) {
	switch (view) {
		case "attention":
			return itemNeedsAttention(item);
		case "available":
			return isItemAvailable(item);
		case "held":
			return item.inCustody;
		case "all":
			return true;
	}
}

export function itemViewCounts(items: readonly ListItem[]) {
	return Object.fromEntries(
		ITEM_VIEWS.map((view) => [
			view,
			items.filter((item) => itemMatchesView(item, view)).length,
		]),
	) as Record<ItemView, number>;
}

/** Items open on attention when something needs it, otherwise on everything. */
export function defaultItemView(items: readonly ListItem[]): ItemView {
	return items.some(itemNeedsAttention) ? "attention" : "all";
}

export interface EquipmentKpis {
	outstanding: number;
	/** Distinct holders with an outstanding return. */
	outstandingHolders: number;
	overdue: number;
	/** Days the longest-overdue return is late. */
	oldestOverdueDays: number | null;
	dueSoon: number;
	/** The earliest deadline among returns due soon. */
	nextDueDate: string | null;
	readyToIssue: number;
	/** Identified items that are neither retired nor archived. */
	identifiedItems: number;
}

export function equipmentKpis(
	assignments: readonly ListAssignment[],
	items: readonly ListItem[],
	today: string,
): EquipmentKpis {
	const outstanding = assignments.filter((a) => a.outstanding);
	const overdueDays = outstanding.flatMap((a) => {
		const state = deadlineState(a, today);
		return state.kind === "overdue" ? [state.days] : [];
	});
	const soon = outstanding
		.filter((a) => isDueSoon(a, today))
		.map((a) => a.effectiveDeadline as string)
		.sort((left, right) => daysFrom(right, left));
	return {
		outstanding: outstanding.length,
		outstandingHolders: new Set(outstanding.map((a) => a.employeeId)).size,
		overdue: overdueDays.length,
		oldestOverdueDays: overdueDays.length ? Math.max(...overdueDays) : null,
		dueSoon: soon.length,
		nextDueDate: soon[0] ?? null,
		readyToIssue: items.filter(isItemAvailable).length,
		identifiedItems: items.filter(
			(item) => !item.archived && item.status !== "retired",
		).length,
	};
}

/** `soon` is the "Due within 14 days" figure; the status toggle offers the other three. */
export type AssignmentStatusView = "outstanding" | "overdue" | "soon" | "all";
export const ASSIGNMENT_STATUS_VIEWS: readonly AssignmentStatusView[] = [
	"outstanding",
	"overdue",
	"soon",
	"all",
];
/** `only` keeps a former-employee-only link working; the switch itself shows or hides. */
export type FormerView = "show" | "hide" | "only";

export interface AssignmentFilters {
	status: AssignmentStatusView;
	holderId: string | null;
	typeId: string | null;
	former: FormerView;
	search: string;
}

export const DEFAULT_ASSIGNMENT_FILTERS: AssignmentFilters = {
	status: "outstanding",
	holderId: null,
	typeId: null,
	former: "show",
	search: "",
};

export function matchesStatus(
	assignment: Pick<
		ListAssignment,
		"outstanding" | "overdue" | "effectiveDeadline"
	>,
	status: AssignmentStatusView,
	today: string,
) {
	if (status === "outstanding") return assignment.outstanding;
	if (status === "overdue") return assignment.outstanding && assignment.overdue;
	if (status === "soon") return isDueSoon(assignment, today);
	return true;
}

function normalized(value: string) {
	return value.normalize("NFKC").toLocaleLowerCase().trim();
}

/** Every filter except the status, which the status toggle counts separately. */
export function matchesListFilters(
	assignment: ListAssignment,
	filters: Omit<AssignmentFilters, "status">,
) {
	if (filters.holderId && assignment.employeeId !== filters.holderId)
		return false;
	if (filters.typeId && assignment.typeId !== filters.typeId) return false;
	if (filters.former === "hide" && assignment.former) return false;
	if (filters.former === "only" && !assignment.former) return false;
	const search = normalized(filters.search);
	if (!search) return true;
	return [
		assignment.identifier,
		assignment.typeName,
		assignment.holderName,
		assignment.serialNumber ?? "",
	].some((value) => normalized(value).includes(search));
}

export function filterAssignments<T extends ListAssignment>(
	assignments: readonly T[],
	filters: AssignmentFilters,
	today: string,
) {
	return assignments.filter(
		(a) =>
			matchesListFilters(a, filters) && matchesStatus(a, filters.status, today),
	);
}

export function statusCounts(
	assignments: readonly ListAssignment[],
	filters: Omit<AssignmentFilters, "status">,
	today: string,
) {
	const visible = assignments.filter((a) => matchesListFilters(a, filters));
	return Object.fromEntries(
		ASSIGNMENT_STATUS_VIEWS.map((status) => [
			status,
			visible.filter((a) => matchesStatus(a, status, today)).length,
		]),
	) as Record<AssignmentStatusView, number>;
}

export function hasActiveFilters(
	filters: AssignmentFilters,
	defaultStatus: AssignmentStatusView = DEFAULT_ASSIGNMENT_FILTERS.status,
) {
	return (
		filters.status !== defaultStatus ||
		!!filters.holderId ||
		!!filters.typeId ||
		filters.former !== DEFAULT_ASSIGNMENT_FILTERS.former ||
		!!filters.search.trim()
	);
}

export type AssignmentSortColumn = "holder" | "item" | "deadline";
export interface AssignmentSort {
	column: AssignmentSortColumn;
	direction: "asc" | "desc";
}
export const DEFAULT_ASSIGNMENT_SORT: AssignmentSort = {
	column: "deadline",
	direction: "asc",
};

/**
 * The default order puts overdue returns first, then the soonest deadline; an
 * assignment without a deadline always comes last. Holder and item sort by name
 * with natural number order ("L-2" before "L-10").
 */
export function sortAssignments<T extends ListAssignment>(
	assignments: readonly T[],
	sort: AssignmentSort,
	locale?: string,
) {
	const collator = new Intl.Collator(locale, {
		numeric: true,
		sensitivity: "base",
	});
	const byIdentity = (left: T, right: T) =>
		collator.compare(left.identifier, right.identifier) ||
		collator.compare(left.holderName, right.holderName) ||
		left.id.localeCompare(right.id);
	const sign = sort.direction === "asc" ? 1 : -1;
	const compare = (left: T, right: T) => {
		if (sort.column === "holder")
			return (
				sign * collator.compare(left.holderName, right.holderName) ||
				byIdentity(left, right)
			);
		if (sort.column === "item")
			return (
				sign * collator.compare(left.identifier, right.identifier) ||
				collator.compare(left.holderName, right.holderName) ||
				left.id.localeCompare(right.id)
			);
		const leftDeadline = left.effectiveDeadline;
		const rightDeadline = right.effectiveDeadline;
		if (!leftDeadline || !rightDeadline)
			return leftDeadline ? -1 : rightDeadline ? 1 : byIdentity(left, right);
		if (sort.direction === "asc") {
			const overdue =
				Number(right.outstanding && right.overdue) -
				Number(left.outstanding && left.overdue);
			if (overdue) return overdue;
		}
		// Negative when the left deadline is earlier.
		const order = -Math.sign(daysFrom(leftDeadline, rightDeadline));
		return sign * order || byIdentity(left, right);
	};
	return [...assignments].sort(compare);
}

export interface PersonalGroups<T> {
	/** Outstanding returns, overdue first, then by deadline. */
	toReturn: T[];
	/** Equipment issued to keep and still held. */
	keep: T[];
	/** Physically received, and returns closed as lost or waived. */
	closed: T[];
}

export function groupPersonalAssignments<T extends ListAssignment>(
	assignments: readonly T[],
	locale?: string,
): PersonalGroups<T> {
	const toReturn = sortAssignments(
		assignments.filter((a) => a.outstanding),
		DEFAULT_ASSIGNMENT_SORT,
		locale,
	);
	const keep = assignments.filter(
		(a) => !a.outstanding && !a.returnRequired && a.held,
	);
	const closed = assignments.filter(
		(a) => !a.outstanding && !(a.held && !a.returnRequired),
	);
	return { toReturn, keep, closed };
}
