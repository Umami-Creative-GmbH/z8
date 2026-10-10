import { describe, expect, it } from "vitest";
import { parseCustomFieldChange } from "./definition-rules";

const create = (overrides: Record<string, unknown> = {}) => ({
	kind: "create",
	entity: "employee",
	name: "Personnel number",
	type: "text",
	required: false,
	tracked: false,
	visibility: "manager",
	editLevel: "admin",
	...overrides,
});

describe("parseCustomFieldChange: create", () => {
	it("accepts a text field and trims its name", () => {
		expect(parseCustomFieldChange(create({ name: "  Personnel number  " }))).toEqual({
			ok: true,
			change: {
				kind: "create",
				entity: "employee",
				name: "Personnel number",
				type: "text",
				required: false,
				tracked: false,
				visibility: "manager",
				editLevel: "admin",
				number: null,
				options: [],
			},
		});
	});

	it("accepts every entity and type", () => {
		for (const entity of ["employee", "project", "customer"]) {
			for (const type of ["text", "number", "date", "boolean"]) {
				expect(parseCustomFieldChange(create({ entity, type })).ok).toBe(true);
			}
			expect(parseCustomFieldChange(create({ entity, type: "select", options: ["A"] })).ok).toBe(
				true,
			);
		}
	});

	it("refuses an unknown entity or type", () => {
		expect(parseCustomFieldChange(create({ entity: "time_entry" }))).toEqual({
			ok: false,
			reason: "invalid_entity",
		});
		expect(parseCustomFieldChange(create({ type: "multi_select" }))).toEqual({
			ok: false,
			reason: "invalid_type",
		});
	});

	it("refuses an empty or overlong name", () => {
		expect(parseCustomFieldChange(create({ name: "   " }))).toEqual({
			ok: false,
			reason: "invalid_name",
		});
		expect(parseCustomFieldChange(create({ name: "x".repeat(101) }))).toEqual({
			ok: false,
			reason: "invalid_name",
		});
		expect(parseCustomFieldChange(create({ name: "x".repeat(100) })).ok).toBe(true);
	});

	it("refuses an edit level of employee", () => {
		expect(
			parseCustomFieldChange(create({ visibility: "employee", editLevel: "employee" })),
		).toEqual({ ok: false, reason: "employees_never_edit" });
	});

	it("refuses an edit level broader than the visibility", () => {
		expect(parseCustomFieldChange(create({ visibility: "admin", editLevel: "manager" }))).toEqual({
			ok: false,
			reason: "edit_level_broader_than_visibility",
		});
		expect(
			parseCustomFieldChange(create({ visibility: "employee", editLevel: "manager" })).ok,
		).toBe(true);
		expect(parseCustomFieldChange(create({ visibility: "admin", editLevel: "admin" })).ok).toBe(
			true,
		);
	});

	it("refuses an unknown visibility or edit level", () => {
		expect(parseCustomFieldChange(create({ visibility: "owner" }))).toEqual({
			ok: false,
			reason: "invalid_level",
		});
		expect(parseCustomFieldChange(create({ editLevel: undefined }))).toEqual({
			ok: false,
			reason: "invalid_level",
		});
	});

	it("refuses a required boolean field", () => {
		expect(parseCustomFieldChange(create({ type: "boolean", required: true }))).toEqual({
			ok: false,
			reason: "boolean_cannot_be_required",
		});
	});

	it("keeps number settings, with comma decimals and integer bounds", () => {
		const parsed = parseCustomFieldChange(
			create({ type: "number", number: { integerOnly: false, min: "-1,5", max: "100" } }),
		);
		expect(parsed).toMatchObject({
			ok: true,
			change: { number: { integerOnly: false, min: "-1.5", max: "100" } },
		});
		expect(
			parseCustomFieldChange(create({ type: "number", number: { integerOnly: true } })),
		).toMatchObject({ ok: true, change: { number: { integerOnly: true, min: null, max: null } } });
		expect(parseCustomFieldChange(create({ type: "number" }))).toMatchObject({
			ok: true,
			change: { number: { integerOnly: false, min: null, max: null } },
		});
	});

	it("refuses number bounds that are not numbers, inverted, or fractional for integers", () => {
		for (const number of [
			{ min: "abc" },
			{ min: "10", max: "1" },
			{ integerOnly: true, min: "1.5" },
			{ min: "1e5" },
		]) {
			expect(parseCustomFieldChange(create({ type: "number", number }))).toEqual({
				ok: false,
				reason: "invalid_number_bounds",
			});
		}
	});

	it("ignores number settings on other types", () => {
		expect(
			parseCustomFieldChange(create({ type: "text", number: { integerOnly: true, min: "1" } })),
		).toMatchObject({ ok: true, change: { number: null } });
	});

	it("needs at least one option for a select field and refuses duplicate labels", () => {
		expect(parseCustomFieldChange(create({ type: "select", options: [] }))).toEqual({
			ok: false,
			reason: "select_needs_option",
		});
		expect(parseCustomFieldChange(create({ type: "select", options: ["A", " a "] }))).toEqual({
			ok: false,
			reason: "duplicate_option_label",
		});
		expect(parseCustomFieldChange(create({ type: "select", options: ["A", " "] }))).toEqual({
			ok: false,
			reason: "invalid_option_label",
		});
		expect(
			parseCustomFieldChange(create({ type: "select", options: [" Gold ", "Silver"] })),
		).toMatchObject({ ok: true, change: { options: ["Gold", "Silver"] } });
	});

	it("drops options on other types", () => {
		expect(parseCustomFieldChange(create({ type: "text", options: ["A"] }))).toMatchObject({
			ok: true,
			change: { options: [] },
		});
	});
});

describe("parseCustomFieldChange: update", () => {
	const update = (overrides: Record<string, unknown> = {}) => ({
		kind: "update",
		fieldId: "f1",
		name: "Cost centre",
		required: true,
		visibility: "employee",
		editLevel: "manager",
		...overrides,
	});

	it("accepts a rename and configuration change", () => {
		expect(parseCustomFieldChange(update())).toEqual({
			ok: true,
			change: {
				kind: "update",
				fieldId: "f1",
				name: "Cost centre",
				required: true,
				visibility: "employee",
				editLevel: "manager",
				number: null,
				type: undefined,
				tracked: undefined,
			},
		});
	});

	it("passes a requested type or tracked flag through for the store to compare", () => {
		expect(parseCustomFieldChange(update({ type: "number", tracked: true }))).toMatchObject({
			ok: true,
			change: { type: "number", tracked: true },
		});
	});

	it("applies the level rules", () => {
		expect(parseCustomFieldChange(update({ editLevel: "employee" }))).toEqual({
			ok: false,
			reason: "employees_never_edit",
		});
		expect(parseCustomFieldChange(update({ visibility: "admin" }))).toEqual({
			ok: false,
			reason: "edit_level_broader_than_visibility",
		});
	});
});

describe("parseCustomFieldChange: other changes", () => {
	it("accepts archive, restore and reorder", () => {
		expect(parseCustomFieldChange({ kind: "archive", fieldId: "f1" })).toEqual({
			ok: true,
			change: { kind: "archive", fieldId: "f1" },
		});
		expect(parseCustomFieldChange({ kind: "restore", fieldId: "f1" })).toEqual({
			ok: true,
			change: { kind: "restore", fieldId: "f1" },
		});
		expect(
			parseCustomFieldChange({ kind: "reorder", entity: "project", fieldIds: ["b", "a"] }),
		).toEqual({ ok: true, change: { kind: "reorder", entity: "project", fieldIds: ["b", "a"] } });
	});

	it("refuses a reorder with duplicate ids", () => {
		expect(
			parseCustomFieldChange({ kind: "reorder", entity: "project", fieldIds: ["a", "a"] }),
		).toEqual({ ok: false, reason: "stale_order" });
	});

	it("accepts option changes with trimmed labels", () => {
		expect(parseCustomFieldChange({ kind: "addOption", fieldId: "f1", label: " Gold " })).toEqual({
			ok: true,
			change: { kind: "addOption", fieldId: "f1", label: "Gold" },
		});
		expect(
			parseCustomFieldChange({ kind: "renameOption", optionId: "o1", label: "Silver" }),
		).toEqual({ ok: true, change: { kind: "renameOption", optionId: "o1", label: "Silver" } });
		expect(parseCustomFieldChange({ kind: "renameOption", optionId: "o1", label: "" })).toEqual({
			ok: false,
			reason: "invalid_option_label",
		});
		expect(parseCustomFieldChange({ kind: "archiveOption", optionId: "o1" }).ok).toBe(true);
		expect(parseCustomFieldChange({ kind: "restoreOption", optionId: "o1" }).ok).toBe(true);
		expect(
			parseCustomFieldChange({ kind: "reorderOptions", fieldId: "f1", optionIds: ["o2", "o1"] }),
		).toEqual({
			ok: true,
			change: { kind: "reorderOptions", fieldId: "f1", optionIds: ["o2", "o1"] },
		});
	});

	it("refuses malformed changes", () => {
		for (const input of [
			null,
			"create",
			{ kind: "delete", fieldId: "f1" },
			{ kind: "archive" },
			{ kind: "reorder", entity: "project", fieldIds: "a" },
		]) {
			expect(parseCustomFieldChange(input)).toEqual({ ok: false, reason: "invalid_change" });
		}
	});
});
