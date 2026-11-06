import { describe, expect, it } from "vitest";
import type {
	EquipmentAssignmentView,
	EquipmentReadinessItemView,
} from "@/lib/organization/equipment/contracts";
import {
	assignmentStatus,
	DEFAULT_ASSIGNMENT_FILTERS,
	DEFAULT_ASSIGNMENT_SORT,
	deadlineState,
	defaultItemView,
	equipmentKpis,
	filterAssignments,
	groupPersonalAssignments,
	hasActiveFilters,
	itemMatchesView,
	itemViewCounts,
	sortAssignments,
	statusCounts,
} from "./equipment-list";
import { heldAssignment } from "./testing/equipment-view.test-fixture";

const today = "2026-11-05";
function assignment(
	id: string,
	patch: Partial<EquipmentAssignmentView> = {},
): EquipmentAssignmentView {
	return {
		...heldAssignment,
		id,
		identifier: id,
		overdue: false,
		effectiveDeadline: null,
		explicitDeadline: null,
		...patch,
	};
}
const overdue = assignment("L-OVERDUE", {
	effectiveDeadline: "2026-11-01",
	overdue: true,
	holderName: "Mira Schulz",
	employeeId: "mira",
	former: true,
});
const dueToday = assignment("L-TODAY", { effectiveDeadline: today });
const dueIn14 = assignment("L-14", { effectiveDeadline: "2026-11-19" });
const dueIn15 = assignment("L-15", { effectiveDeadline: "2026-11-20" });
const undated = assignment("L-UNDATED");
const returned = assignment("L-RETURNED", {
	outstanding: false,
	held: false,
	outstandingQuantity: 0,
	effectiveDeadline: "2026-10-01",
});
const keep = assignment("GLOVES", {
	outstanding: false,
	returnRequired: false,
	outstandingQuantity: 0,
	typeName: "Workwear",
	trackingMode: "quantity",
});
const closed = assignment("L-LOST", {
	outstanding: false,
	outstandingQuantity: 0,
	lostQuantity: 1,
});

describe("assignment status and deadlines", () => {
	it("labels physical receipt before the obligation's state", () => {
		expect(assignmentStatus(overdue)).toBe("overdue");
		expect(assignmentStatus(dueToday)).toBe("outstanding");
		expect(assignmentStatus(returned)).toBe("received");
		expect(assignmentStatus(keep)).toBe("keep");
		expect(assignmentStatus(closed)).toBe("closed");
	});

	it("reads overdue days and due-soon days in calendar days from the organization's today", () => {
		expect(deadlineState(overdue, today)).toEqual({ kind: "overdue", days: 4 });
		expect(deadlineState(dueToday, today)).toEqual({ kind: "soon", days: 0 });
		expect(deadlineState(dueIn14, today)).toEqual({ kind: "soon", days: 14 });
		expect(deadlineState(dueIn15, today)).toEqual({ kind: "plain" });
		expect(deadlineState(undated, today)).toEqual({ kind: "none" });
		// A settled return is never urgent, whatever its deadline.
		expect(deadlineState(returned, today)).toEqual({ kind: "plain" });
	});

	it("counts across a daylight-saving change as whole calendar days", () => {
		const march = assignment("DST", { effectiveDeadline: "2026-03-30" });
		expect(deadlineState(march, "2026-03-28")).toEqual({
			kind: "soon",
			days: 2,
		});
	});
});

describe("key figures", () => {
	const item = (
		patch: Partial<EquipmentReadinessItemView>,
	): EquipmentReadinessItemView => ({
		id: "item",
		typeId: "type",
		typeName: "Laptop",
		identifier: "I-1",
		serialNumber: null,
		status: "available",
		inCustody: false,
		archived: false,
		revision: 1,
		canClear: false,
		canMarkUnavailable: true,
		canRetire: true,
		history: [],
		...patch,
	});
	it("counts outstanding, overdue, due within 14 days and items ready to issue", () => {
		expect(
			equipmentKpis(
				[overdue, dueToday, dueIn14, dueIn15, undated, returned, keep],
				[
					item({}),
					item({ inCustody: true }),
					item({ status: "unavailable" }),
					item({ status: "retired" }),
					item({ archived: true }),
				],
				today,
			),
		).toEqual({
			outstanding: 5,
			outstandingHolders: 2,
			overdue: 1,
			oldestOverdueDays: 4,
			dueSoon: 2,
			nextDueDate: today,
			readyToIssue: 1,
			identifiedItems: 3,
		});
	});

	it("has no oldest overdue or next due date when nothing qualifies", () => {
		expect(equipmentKpis([undated, keep], [], today)).toMatchObject({
			overdue: 0,
			oldestOverdueDays: null,
			dueSoon: 0,
			nextDueDate: null,
			identifiedItems: 0,
		});
	});

	it("puts items needing a decision or a custody receipt under attention", () => {
		const damaged = item({ status: "unavailable" });
		const proposal = item({ inCustody: true, canProposeCustodyReceipt: true });
		const confirmed = item({
			inCustody: false,
			custodyReceipt: {
				id: "r",
				actualDate: today,
				condition: "good",
				proposedBy: "a",
				proposedAt: "2026-11-05T10:00:00Z",
				confirmedBy: "b",
				confirmedAt: "2026-11-05T11:00:00Z",
				canConfirm: false,
			},
		});
		const items = [damaged, proposal, confirmed, item({ status: "retired" })];
		expect(itemViewCounts(items)).toEqual({
			attention: 2,
			available: 1,
			held: 1,
			all: 4,
		});
		expect(itemMatchesView(item({ status: "retired" }), "attention")).toBe(
			false,
		);
		expect(defaultItemView(items)).toBe("attention");
		expect(defaultItemView([confirmed])).toBe("all");
	});
});

describe("assignment filters", () => {
	const list = [overdue, dueToday, dueIn14, dueIn15, undated, returned, keep];
	it("opens on outstanding returns and narrows by status", () => {
		const ids = (status: (typeof DEFAULT_ASSIGNMENT_FILTERS)["status"]) =>
			filterAssignments(
				list,
				{ ...DEFAULT_ASSIGNMENT_FILTERS, status },
				today,
			).map((a) => a.id);
		expect(DEFAULT_ASSIGNMENT_FILTERS.status).toBe("outstanding");
		expect(ids("outstanding")).toEqual([
			"L-OVERDUE",
			"L-TODAY",
			"L-14",
			"L-15",
			"L-UNDATED",
		]);
		expect(ids("overdue")).toEqual(["L-OVERDUE"]);
		expect(ids("soon")).toEqual(["L-TODAY", "L-14"]);
		expect(ids("all")).toHaveLength(list.length);
	});

	it("searches identifier, type, holder and serial number, ignoring case", () => {
		const search = (text: string) =>
			filterAssignments(
				list,
				{ ...DEFAULT_ASSIGNMENT_FILTERS, status: "all", search: text },
				today,
			).map((a) => a.id);
		expect(search("mira")).toEqual(["L-OVERDUE"]);
		expect(search("workwear")).toEqual(["GLOVES"]);
		expect(search("l-1")).toEqual(["L-14", "L-15"]);
		expect(
			filterAssignments(
				[{ ...undated, serialNumber: "C02XK1" }],
				{ ...DEFAULT_ASSIGNMENT_FILTERS, search: "c02x" },
				today,
			),
		).toHaveLength(1);
	});

	it("filters holder and type, hides or isolates former employees, and counts statuses under them", () => {
		const base = { ...DEFAULT_ASSIGNMENT_FILTERS, status: "all" as const };
		expect(
			filterAssignments(list, { ...base, holderId: "mira" }, today).map(
				(a) => a.id,
			),
		).toEqual(["L-OVERDUE"]);
		expect(
			filterAssignments(list, { ...base, typeId: "nope" }, today),
		).toHaveLength(0);
		expect(
			filterAssignments(list, { ...base, former: "hide" }, today).some(
				(a) => a.former,
			),
		).toBe(false);
		expect(
			filterAssignments(list, { ...base, former: "only" }, today).map(
				(a) => a.id,
			),
		).toEqual(["L-OVERDUE"]);
		expect(statusCounts(list, { ...base, former: "hide" }, today)).toEqual({
			outstanding: 4,
			overdue: 0,
			soon: 2,
			all: 6,
		});
	});

	it("only counts as filtered when something differs from the view's default", () => {
		expect(hasActiveFilters(DEFAULT_ASSIGNMENT_FILTERS)).toBe(false);
		expect(
			hasActiveFilters({ ...DEFAULT_ASSIGNMENT_FILTERS, search: "  " }),
		).toBe(false);
		expect(
			hasActiveFilters({ ...DEFAULT_ASSIGNMENT_FILTERS, status: "all" }, "all"),
		).toBe(false);
		expect(
			hasActiveFilters({ ...DEFAULT_ASSIGNMENT_FILTERS, former: "hide" }),
		).toBe(true);
	});
});

describe("assignment order", () => {
	it("puts overdue first, then the soonest deadline, and undated last", () => {
		expect(
			sortAssignments(
				[undated, dueIn15, returned, dueToday, overdue],
				DEFAULT_ASSIGNMENT_SORT,
				"en",
			).map((a) => a.id),
		).toEqual(["L-OVERDUE", "L-RETURNED", "L-TODAY", "L-15", "L-UNDATED"]);
	});

	it("reverses the deadline order but keeps undated last", () => {
		expect(
			sortAssignments(
				[undated, dueIn15, dueToday, overdue],
				{ column: "deadline", direction: "desc" },
				"en",
			).map((a) => a.id),
		).toEqual(["L-15", "L-TODAY", "L-OVERDUE", "L-UNDATED"]);
	});

	it("sorts holders and items by name with natural number order", () => {
		const a2 = assignment("L-2", { holderName: "Zoe" });
		const a10 = assignment("L-10", { holderName: "anna" });
		expect(
			sortAssignments(
				[a10, a2],
				{ column: "item", direction: "asc" },
				"en",
			).map((a) => a.id),
		).toEqual(["L-2", "L-10"]);
		expect(
			sortAssignments(
				[a2, a10],
				{ column: "holder", direction: "asc" },
				"en",
			).map((a) => a.id),
		).toEqual(["L-10", "L-2"]);
		expect(
			sortAssignments(
				[a10, a2],
				{ column: "holder", direction: "desc" },
				"en",
			).map((a) => a.id),
		).toEqual(["L-2", "L-10"]);
	});
});

describe("My equipment groups", () => {
	it("groups to return (overdue first), yours to keep, and returned or closed", () => {
		const keptReturned = assignment("KEPT-BACK", {
			outstanding: false,
			returnRequired: false,
			held: false,
		});
		const groups = groupPersonalAssignments(
			[keep, undated, returned, overdue, dueToday, closed, keptReturned],
			"en",
		);
		expect(groups.toReturn.map((a) => a.id)).toEqual([
			"L-OVERDUE",
			"L-TODAY",
			"L-UNDATED",
		]);
		expect(groups.keep.map((a) => a.id)).toEqual(["GLOVES"]);
		expect(groups.closed.map((a) => a.id)).toEqual([
			"L-RETURNED",
			"L-LOST",
			"KEPT-BACK",
		]);
	});
});
