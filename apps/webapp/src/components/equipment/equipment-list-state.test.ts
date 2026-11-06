import { describe, expect, it } from "vitest";
import {
	assignmentHref,
	DEFAULT_EQUIPMENT_LIST_QUERY,
	equipmentListHref,
	equipmentListSearch,
	equipmentReturnPath,
	parseEquipmentListQuery,
} from "./equipment-list-state";

const holder = "15370000-0000-4000-8000-000000000001";
const type = "15370000-0000-4000-8000-000000000010";

describe("overview URL filters", () => {
	it("opens on outstanding returns without parameters", () => {
		expect(parseEquipmentListQuery({})).toEqual(DEFAULT_EQUIPMENT_LIST_QUERY);
		expect(DEFAULT_EQUIPMENT_LIST_QUERY).toEqual({
			status: "outstanding",
			holderId: null,
			typeId: null,
			former: "show",
		});
		expect(equipmentListHref(DEFAULT_EQUIPMENT_LIST_QUERY)).toBe("/equipment");
	});

	it("keeps reminder links working: a holder's outstanding returns", () => {
		expect(
			parseEquipmentListQuery(
				new URLSearchParams(`holderId=${holder}&outstanding=true`),
			),
		).toEqual({ ...DEFAULT_EQUIPMENT_LIST_QUERY, holderId: holder });
	});

	it("reads the equipment filter schema's parameters", () => {
		expect(
			parseEquipmentListQuery({
				holderId: holder,
				typeId: type,
				overdue: "true",
				former: "false",
			}),
		).toEqual({
			status: "overdue",
			holderId: holder,
			typeId: type,
			former: "hide",
		});
		expect(parseEquipmentListQuery({ former: "true" }).former).toBe("only");
		expect(parseEquipmentListQuery({ outstanding: "false" }).status).toBe(
			"all",
		);
		expect(parseEquipmentListQuery({ status: "all" }).status).toBe("all");
		expect(parseEquipmentListQuery({ status: "soon" }).status).toBe("soon");
		expect(parseEquipmentListQuery({ status: ["all", "soon"] }).status).toBe(
			"all",
		);
	});

	it("ignores references that are not identifiers", () => {
		expect(
			parseEquipmentListQuery({ holderId: "' or 1=1", typeId: "x" }),
		).toEqual(DEFAULT_EQUIPMENT_LIST_QUERY);
	});

	it("round-trips every state through the query string", () => {
		for (const query of [
			DEFAULT_EQUIPMENT_LIST_QUERY,
			{ status: "overdue", holderId: holder, typeId: null, former: "show" },
			{ status: "all", holderId: null, typeId: type, former: "hide" },
			{ status: "soon", holderId: null, typeId: null, former: "only" },
		] as const)
			expect(
				parseEquipmentListQuery(
					new URLSearchParams(equipmentListSearch(query)),
				),
			).toEqual(query);
		expect(
			equipmentListSearch({
				status: "overdue",
				holderId: holder,
				typeId: type,
				former: "hide",
			}),
		).toBe(`holderId=${holder}&typeId=${type}&overdue=true&former=false`);
	});
});

describe("assignment page links", () => {
	it("returns to the list it was opened from, and only to an equipment list", () => {
		expect(
			equipmentReturnPath(`/equipment?holderId=${holder}&overdue=true`),
		).toBe(`/equipment?holderId=${holder}&overdue=true`);
		expect(equipmentReturnPath(`/equipment/employees/${holder}`)).toBe(
			`/equipment/employees/${holder}`,
		);
		for (const unsafe of [
			undefined,
			"https://evil.test/equipment",
			"//evil.test",
			"/settings",
			"/equipment/assignments/x",
			"/equipment?x=<script>",
		])
			expect(equipmentReturnPath(unsafe)).toBe("/equipment");
	});

	it("carries a filtered list in `back` and leaves the default list implicit", () => {
		expect(assignmentHref("a1")).toBe("/equipment/assignments/a1");
		expect(assignmentHref("a1", "/equipment")).toBe(
			"/equipment/assignments/a1",
		);
		const href = assignmentHref("a1", "/equipment?overdue=true");
		expect(new URL(href, "https://z8.test").searchParams.get("back")).toBe(
			"/equipment?overdue=true",
		);
	});
});
