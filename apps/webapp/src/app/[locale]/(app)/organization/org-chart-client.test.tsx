/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgChartGraph } from "./org-chart-types";

const { searchMock, employeeNeighborhoodMock, teamNeighborhoodMock } = vi.hoisted(() => ({
	searchMock: vi.fn(),
	employeeNeighborhoodMock: vi.fn(),
	teamNeighborhoodMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("./actions", () => ({
	searchOrgEmployees: searchMock,
	getEmployeeNeighborhood: employeeNeighborhoodMock,
	getTeamNeighborhood: teamNeighborhoodMock,
}));

vi.mock("@xyflow/react", () => ({
	Background: () => <div data-testid="flow-background" />,
	Controls: () => <div data-testid="flow-controls" />,
	MiniMap: () => <div data-testid="flow-minimap" />,
	ReactFlow: ({ nodes, edges }: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }) => (
		<div data-testid="react-flow">
			<div data-testid="node-count">{nodes.length}</div>
			<div data-testid="edge-count">{edges.length}</div>
		</div>
	),
	ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	useReactFlow: () => ({ fitView: vi.fn() }),
}));

const graph: OrgChartGraph = {
	mode: "focused",
	focusedEmployeeId: "emp-1",
	employeeCount: 101,
	partial: true,
	nodes: [
		{
			id: "employee:emp-1",
			kind: "employee",
			employeeId: "emp-1",
			userId: "user-1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
			position: "Engineer",
			role: "employee",
			isActive: true,
			teamIds: [],
			isFocused: true,
			expandable: { managers: true, reports: true, teams: true },
		},
	],
	edges: [],
};

describe("OrgChartClient", () => {
	beforeEach(() => {
		searchMock.mockReset();
		employeeNeighborhoodMock.mockReset();
		teamNeighborhoodMock.mockReset();
	});

	it("renders an empty state when no nodes are available", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={{ ...graph, nodes: [], employeeCount: 0, partial: false }} />);

		expect(screen.getByText("No active employees found")).toBeTruthy();
	});

	it("renders graph counts and partial loading notice", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		expect(screen.getByTestId("react-flow")).toBeTruthy();
		expect(screen.getByTestId("node-count").textContent).toBe("1");
		expect(screen.getByText("Showing part of a large organization. Expand nodes or search to continue."));
	});

	it("searches employees and focuses the selected result", async () => {
		searchMock.mockResolvedValueOnce({
			success: true,
			data: [{ employeeId: "emp-2", name: "Grace Hopper", email: "grace@example.com", position: "Manager", image: null, role: "manager" }],
		});
		employeeNeighborhoodMock.mockResolvedValueOnce({
			success: true,
			data: { ...graph, focusedEmployeeId: "emp-2", nodes: [{ ...graph.nodes[0], id: "employee:emp-2", employeeId: "emp-2", name: "Grace Hopper", isFocused: true }] },
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });
		fireEvent.click(await screen.findByRole("button", { name: "Grace Hopper grace@example.com" }));

		await waitFor(() => expect(employeeNeighborhoodMock).toHaveBeenCalledWith("emp-2"));
	});
});
