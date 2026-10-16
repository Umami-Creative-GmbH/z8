import { describe, expect, it } from "vitest";
import { isTaskRequirementActive } from "./task-requirement";

describe("isTaskRequirementActive", () => {
	it("is active when the project requires a task and has an open task", () => {
		expect(
			isTaskRequirementActive({
				requiresTask: true,
				tasks: [{ state: "done" }, { state: "open" }],
			}),
		).toBe(true);
	});

	it("is not active when the project has no tasks", () => {
		expect(isTaskRequirementActive({ requiresTask: true, tasks: [] })).toBe(false);
	});

	it("lapses when every task is done", () => {
		expect(
			isTaskRequirementActive({
				requiresTask: true,
				tasks: [{ state: "done" }, { state: "done" }],
			}),
		).toBe(false);
	});

	it("is not active when the requirement is off, even with open tasks", () => {
		expect(isTaskRequirementActive({ requiresTask: false, tasks: [{ state: "open" }] })).toBe(
			false,
		);
	});

	it("takes an open-task count or flag from callers that already counted", () => {
		expect(isTaskRequirementActive({ requiresTask: true, openTaskCount: 2 })).toBe(true);
		expect(isTaskRequirementActive({ requiresTask: true, openTaskCount: 0 })).toBe(false);
		expect(isTaskRequirementActive({ requiresTask: true, hasOpenTask: true })).toBe(true);
		expect(isTaskRequirementActive({ requiresTask: false, hasOpenTask: true })).toBe(false);
	});
});
