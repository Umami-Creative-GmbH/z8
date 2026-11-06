import { describe, expect, it } from "vitest";
import { layoutReportingTree } from "./org-explorer-layout";
import { buildReportingTree } from "./org-explorer-tree";
import type { OrgExplorerPerson } from "./org-explorer-types";

function person(
	employeeId: string,
	overrides: Partial<OrgExplorerPerson> = {},
): OrgExplorerPerson {
	return {
		employeeId,
		userId: `user-${employeeId}`,
		name: employeeId,
		pronouns: null,
		email: `${employeeId}@example.com`,
		image: null,
		position: null,
		primaryTeamId: null,
		teamIds: [],
		managerIds: [],
		reportIds: [],
		lineReportIds: [],
		...overrides,
	};
}

describe("layoutReportingTree", () => {
	const tree = buildReportingTree([
		person("Ceo", { reportIds: ["Ada", "Bob"], lineReportIds: ["Ada"] }),
		person("Cto", { reportIds: ["Bob"], lineReportIds: ["Bob"] }),
		person("Ada", { managerIds: ["Ceo"] }),
		person("Bob", { managerIds: ["Cto", "Ceo"] }),
	]);

	it("draws one line per person, from their primary manager", () => {
		const layout = layoutReportingTree(tree, ["Ceo", "Ada", "Cto", "Bob"]);

		expect(layout.edges).toEqual([
			{ source: "Ceo", target: "Ada" },
			{ source: "Cto", target: "Bob" },
		]);
	});

	it("places every manager above their reports", () => {
		const { positions } = layoutReportingTree(tree, [
			"Ceo",
			"Ada",
			"Cto",
			"Bob",
		]);

		expect(positions.get("Ceo")?.y).toBeLessThan(positions.get("Ada")?.y ?? 0);
		expect(positions.get("Cto")?.y).toBeLessThan(positions.get("Bob")?.y ?? 0);
		expect(positions.get("Ceo")?.y).toBe(positions.get("Cto")?.y);
	});

	it("lays out only the visible people", () => {
		const layout = layoutReportingTree(tree, ["Ceo", "Cto"]);

		expect([...layout.positions.keys()].toSorted()).toEqual(["Ceo", "Cto"]);
		expect(layout.edges).toEqual([]);
	});
});
