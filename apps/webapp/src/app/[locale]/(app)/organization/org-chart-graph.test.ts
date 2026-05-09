import { describe, expect, it } from "vitest";
import {
	buildEdgeId,
	buildEmployeeNodeId,
	buildOrgChartGraph,
	buildTeamNodeId,
	mergeOrgChartGraphs,
} from "./org-chart-graph";

const employee = {
	id: "emp-1",
	userId: "user-1",
	name: "Ada Lovelace",
	email: "ada@example.com",
	image: null,
	position: "Engineer",
	role: "employee" as const,
	isActive: true,
	teamIds: ["team-1"],
};

const manager = {
	id: "emp-2",
	userId: "user-2",
	name: "Grace Hopper",
	email: "grace@example.com",
	image: null,
	position: "Manager",
	role: "manager" as const,
	isActive: true,
	teamIds: ["team-1"],
};

const team = {
	id: "team-1",
	name: "Platform",
	description: null,
	memberCount: 2,
	primaryManagerId: "emp-2",
};

describe("org chart graph helpers", () => {
	it("uses stable node and edge ids", () => {
		expect(buildEmployeeNodeId("emp-1")).toBe("employee:emp-1");
		expect(buildTeamNodeId("team-1")).toBe("team:team-1");
		expect(buildEdgeId("manager", "employee:emp-2", "employee:emp-1")).toBe(
			"manager:employee:emp-2->employee:emp-1",
		);
	});

	it("builds employee, team, manager, membership, and primary-manager graph elements", () => {
		const graph = buildOrgChartGraph({
			mode: "full",
			focusedEmployeeId: "emp-1",
			employeeCount: 2,
			partial: false,
			employees: [employee, manager],
			teams: [team],
			managerLinks: [{ managerId: "emp-2", employeeId: "emp-1" }],
			teamMemberships: [
				{ teamId: "team-1", employeeId: "emp-1" },
				{ teamId: "team-1", employeeId: "emp-2" },
			],
		});

		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "employee:emp-1", kind: "employee", isFocused: true }),
				expect.objectContaining({ id: "employee:emp-2", kind: "employee" }),
				expect.objectContaining({ id: "team:team-1", kind: "team", memberCount: 2 }),
			]),
		);
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "manager", source: "employee:emp-2", target: "employee:emp-1" }),
				expect.objectContaining({ kind: "team-membership", source: "team:team-1", target: "employee:emp-1" }),
				expect.objectContaining({ kind: "team-primary-manager", source: "employee:emp-2", target: "team:team-1" }),
			]),
		);
	});

	it("deduplicates nodes and edges when merging expanded graph payloads", () => {
		const first = buildOrgChartGraph({
			mode: "focused",
			focusedEmployeeId: "emp-1",
			employeeCount: 101,
			partial: true,
			employees: [employee],
			teams: [team],
			managerLinks: [],
			teamMemberships: [{ teamId: "team-1", employeeId: "emp-1" }],
		});
		const second = buildOrgChartGraph({
			mode: "focused",
			focusedEmployeeId: "emp-2",
			employeeCount: 101,
			partial: true,
			employees: [employee, manager],
			teams: [team],
			managerLinks: [{ managerId: "emp-2", employeeId: "emp-1" }],
			teamMemberships: [{ teamId: "team-1", employeeId: "emp-1" }],
		});

		const merged = mergeOrgChartGraphs(first, second, "emp-2");

		expect(merged.nodes.filter((node) => node.id === "employee:emp-1")).toHaveLength(1);
		expect(merged.nodes.find((node) => node.id === "employee:emp-2")).toEqual(
			expect.objectContaining({ isFocused: true }),
		);
		expect(new Set(merged.edges.map((edge) => edge.id)).size).toBe(merged.edges.length);
	});
});
