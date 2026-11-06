import { describe, expect, it } from "vitest";
import {
	buildReportingTree,
	defaultExpandedIds,
	visibleTreeIds,
} from "./org-explorer-tree";
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

describe("buildReportingTree", () => {
	it("hangs each person under their primary manager only", () => {
		const tree = buildReportingTree([
			person("Ceo", { reportIds: ["Ada", "Bob"], lineReportIds: ["Ada"] }),
			person("Cto", { reportIds: ["Bob"], lineReportIds: ["Bob"] }),
			person("Ada", { managerIds: ["Ceo"] }),
			person("Bob", { managerIds: ["Cto", "Ceo"] }),
		]);

		expect(tree.childrenOf("Ceo")).toEqual(["Ada"]);
		expect(tree.childrenOf("Cto")).toEqual(["Bob"]);
		expect(tree.parentOf("Bob")).toBe("Cto");
	});

	it("puts people with no manager and line reports on top, and the rest in No reporting line", () => {
		const tree = buildReportingTree([
			person("Zoe", { reportIds: ["Ada"], lineReportIds: ["Ada"] }),
			person("Ada", { managerIds: ["Zoe"] }),
			person("Kim", { reportIds: ["Bob"], lineReportIds: ["Bob"] }),
			person("Bob", { managerIds: ["Kim"] }),
			person("Lou"),
			person("Eve"),
		]);

		expect(tree.roots).toEqual(["Kim", "Zoe"]);
		expect(tree.noReportingLine).toEqual(["Eve", "Lou"]);
	});

	it("puts someone with no manager whose reports all report along another line in No reporting line", () => {
		const tree = buildReportingTree([
			person("Max", { reportIds: ["Bob"] }),
			person("Bob", { managerIds: ["Kim", "Max"] }),
			person("Kim", { reportIds: ["Bob"], lineReportIds: ["Bob"] }),
		]);

		expect(tree.roots).toEqual(["Kim"]);
		expect(tree.noReportingLine).toEqual(["Max"]);
	});

	it("orders roots, children and the No reporting line group by name", () => {
		const tree = buildReportingTree([
			person("ceo", {
				name: "Zora",
				reportIds: ["b", "a"],
				lineReportIds: ["b", "a"],
			}),
			person("b", { name: "Bea", managerIds: ["ceo"] }),
			person("a", { name: "Cleo", managerIds: ["ceo"] }),
			person("x", { name: "Yan" }),
			person("y", { name: "Abe" }),
		]);

		expect(tree.childrenOf("ceo")).toEqual(["b", "a"]);
		expect(tree.noReportingLine).toEqual(["y", "x"]);
	});

	it("breaks a loop of reporting lines at the first person by name, so nobody is lost", () => {
		const tree = buildReportingTree([
			person("Cid", {
				managerIds: ["Bea"],
				reportIds: ["Ana"],
				lineReportIds: ["Ana"],
			}),
			person("Ana", {
				managerIds: ["Cid"],
				reportIds: ["Bea"],
				lineReportIds: ["Bea"],
			}),
			person("Bea", {
				managerIds: ["Ana"],
				reportIds: ["Cid"],
				lineReportIds: ["Cid"],
			}),
		]);

		expect(tree.roots).toEqual(["Ana"]);
		expect(tree.parentOf("Ana")).toBeNull();
		expect(tree.childrenOf("Ana")).toEqual(["Bea"]);
		expect(tree.childrenOf("Bea")).toEqual(["Cid"]);
		expect(tree.childrenOf("Cid")).toEqual([]);
	});

	it("shows a person whose primary manager is not loaded yet on top", () => {
		const tree = buildReportingTree([
			person("Ada", { managerIds: ["unloaded"] }),
		]);

		expect(tree.roots).toEqual(["Ada"]);
		expect(tree.noReportingLine).toEqual([]);
	});

	it("lists the path from the top down to a person", () => {
		const tree = buildReportingTree([
			person("Ceo", { reportIds: ["Vp"], lineReportIds: ["Vp"] }),
			person("Vp", {
				managerIds: ["Ceo"],
				reportIds: ["Ada"],
				lineReportIds: ["Ada"],
			}),
			person("Ada", { managerIds: ["Vp"] }),
		]);

		expect(tree.pathTo("Ada")).toEqual(["Ceo", "Vp", "Ada"]);
		expect(tree.pathTo("Ceo")).toEqual(["Ceo"]);
		expect(tree.pathTo("missing")).toEqual([]);
	});
});

describe("expanding the reporting lines", () => {
	const chain = [
		person("L0", { reportIds: ["L1"], lineReportIds: ["L1"] }),
		person("L1", {
			managerIds: ["L0"],
			reportIds: ["L2"],
			lineReportIds: ["L2"],
		}),
		person("L2", {
			managerIds: ["L1"],
			reportIds: ["L3"],
			lineReportIds: ["L3"],
		}),
		person("L3", { managerIds: ["L2"] }),
	];

	it("opens two levels below the top by default", () => {
		const tree = buildReportingTree(chain);
		const expanded = defaultExpandedIds(tree);

		expect([...expanded].toSorted()).toEqual(["L0", "L1"]);
		expect(visibleTreeIds(tree, expanded)).toEqual(["L0", "L1", "L2"]);
	});

	it("hides the subtree of a collapsed person", () => {
		const tree = buildReportingTree(chain);

		expect(visibleTreeIds(tree, new Set(["L1"]))).toEqual(["L0"]);
		expect(visibleTreeIds(tree, new Set(["L0", "L1", "L2"]))).toEqual([
			"L0",
			"L1",
			"L2",
			"L3",
		]);
	});
});
