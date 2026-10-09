import { describe, expect, it } from "vitest";
import { normalizeProjectTemplateInput } from "./project-template-model";

describe("normalizeProjectTemplateInput", () => {
	it("trims text, treats blanks as none and rounds hours to two decimals", () => {
		expect(
			normalizeProjectTemplateInput({
				name: "  Relaunch ",
				description: "   ",
				icon: " IconRocket ",
				color: "",
				budgetHours: 10.005,
				deadlineOffsetDays: 14,
				tasks: [{ name: " Design ", description: " Wireframes ", estimateHours: 1.234 }],
			}),
		).toEqual({
			ok: true,
			value: {
				name: "Relaunch",
				description: null,
				icon: "IconRocket",
				color: null,
				budgetHours: "10.01",
				deadlineOffsetDays: 14,
				tasks: [{ name: "Design", description: "Wireframes", estimateHours: "1.23" }],
				managerEmployeeIds: [],
				teamIds: [],
				employeeIds: [],
			},
		});
	});

	it("collapses repeated managers and assignments", () => {
		const result = normalizeProjectTemplateInput({
			name: "Relaunch",
			managerEmployeeIds: ["e1", "e1", "e2"],
			assignments: [
				{ type: "team", targetId: "t1" },
				{ type: "team", targetId: "t1" },
				{ type: "employee", targetId: "e1" },
			],
		});

		expect(result).toMatchObject({
			ok: true,
			value: { managerEmployeeIds: ["e1", "e2"], teamIds: ["t1"], employeeIds: ["e1"] },
		});
	});

	it("names the offending task", () => {
		expect(
			normalizeProjectTemplateInput({
				name: "Relaunch",
				tasks: [{ name: "Design" }, { name: "Build", estimateHours: 0 }, { name: "DESIGN" }],
			}),
		).toEqual({ ok: false, problem: "taskEstimateInvalid", taskIndex: 1 });
		expect(
			normalizeProjectTemplateInput({
				name: "Relaunch",
				tasks: [{ name: "Design" }, { name: "DESIGN" }],
			}),
		).toEqual({ ok: false, problem: "taskNameDuplicate", taskIndex: 1 });
	});

	it.each([
		[{ name: " " }, "nameRequired"],
		[{ name: "x", icon: "rocket" }, "iconInvalid"],
		[{ name: "x", color: "#12345" }, "colorInvalid"],
		[{ name: "x", budgetHours: -1 }, "budgetInvalid"],
		[{ name: "x", budgetHours: Number.NaN }, "budgetInvalid"],
		[{ name: "x", deadlineOffsetDays: 3651 }, "deadlineOffsetInvalid"],
		[{ name: "x", deadlineOffsetDays: 2.5 }, "deadlineOffsetInvalid"],
	])("refuses %o with %s", (input, problem) => {
		expect(normalizeProjectTemplateInput(input)).toEqual({ ok: false, problem });
	});

	it("accepts a deadline on the day of creation", () => {
		expect(normalizeProjectTemplateInput({ name: "x", deadlineOffsetDays: 0 })).toMatchObject({
			ok: true,
			value: { deadlineOffsetDays: 0 },
		});
	});
});
