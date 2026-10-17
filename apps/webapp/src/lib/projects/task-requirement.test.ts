import { describe, expect, it } from "vitest";
import { isTaskRequirementActive } from "./task-requirement";

describe("isTaskRequirementActive", () => {
	it("is active when the project requires a task and has an open task", () => {
		expect(isTaskRequirementActive({ requiresTask: true, hasOpenTask: true })).toBe(true);
	});

	it("lapses while the project has no open task", () => {
		expect(isTaskRequirementActive({ requiresTask: true, hasOpenTask: false })).toBe(false);
	});

	it("is not active when the requirement is off, even with open tasks", () => {
		expect(isTaskRequirementActive({ requiresTask: false, hasOpenTask: true })).toBe(false);
	});
});
