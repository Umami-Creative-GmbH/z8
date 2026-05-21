/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgChartGraph } from "./org-chart-types";

const { searchMock, employeeNeighborhoodMock, teamNeighborhoodMock } = vi.hoisted(() => ({
	searchMock: vi.fn(),
	employeeNeighborhoodMock: vi.fn(),
	teamNeighborhoodMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, string | number>) => {
			const message = fallback ?? _key;

			return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
				if (!values || !(name in values)) {
					throw new Error(`Missing value for ${placeholder}`);
				}

				return String(values[name]);
			});
		},
	}),
}));

vi.mock("./actions", () => ({
	searchOrgEmployees: searchMock,
	getEmployeeNeighborhood: employeeNeighborhoodMock,
	getTeamNeighborhood: teamNeighborhoodMock,
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ image, name }: { image?: string | null; name?: string | null }) => (
		<img alt={`${name ?? "User"} avatar`} src={image ?? "data:image/svg+xml,fallback"} />
	),
}));

type MockFlowNode = {
	id: string;
	type?: string;
	data: unknown;
};

type MockFlowEdge = {
	id: string;
	label?: string;
	style?: Record<string, unknown>;
};

vi.mock("@xyflow/react", () => ({
	Background: () => <div data-testid="flow-background" />,
	Controls: (props: { className?: string; position?: string }) => (
		<div data-position={props.position} data-testid="flow-controls" className={props.className} />
	),
	MiniMap: (props: { className?: string; position?: string; maskColor?: string; bgColor?: string }) => (
		<div
			data-bg-color={props.bgColor}
			data-mask-color={props.maskColor}
			data-position={props.position}
			data-testid="flow-minimap"
			className={props.className}
		/>
	),
	MarkerType: { ArrowClosed: "arrowclosed" },
	ReactFlow: ({
		nodes,
		edges,
		nodeTypes,
		children,
	}: {
		nodes: MockFlowNode[];
		edges: MockFlowEdge[];
		nodeTypes: Record<string, (props: { data: unknown }) => ReactNode>;
		children?: ReactNode;
	}) => (
		<div data-testid="react-flow">
			<div data-testid="node-count">{nodes.length}</div>
			<div data-testid="edge-count">{edges.length}</div>
			<div data-testid="edge-labels">{JSON.stringify(edges.map((edge) => edge.label))}</div>
			<div data-testid="edge-styles">{JSON.stringify(edges.map((edge) => edge.style))}</div>
			{nodes.map((node) => {
				const NodeComponent = nodeTypes[node.type ?? ""];

				return NodeComponent ? (
					<div data-testid={`flow-node-${node.id}`} key={node.id}>
						<NodeComponent data={node.data} />
					</div>
				) : null;
			})}
			{children}
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
			pronouns: " she/her ",
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

const teamGraph: OrgChartGraph = {
	...graph,
	nodes: [
		...graph.nodes,
		{
			id: "team:team-1",
			kind: "team",
			teamId: "team-1",
			name: "Platform",
			description: null,
			memberCount: 12,
			primaryManagerId: null,
			expandable: { members: true, primaryManager: false },
		},
	],
	edges: [
		{
			id: "team-membership:team:team-1->employee:emp-1",
			kind: "team-membership",
			source: "team:team-1",
			target: "employee:emp-1",
			label: "Member",
		},
	],
};

const managerGraph: OrgChartGraph = {
	...graph,
	nodes: [
		{
			...graph.nodes[0],
			id: "employee:manager-1",
			employeeId: "manager-1",
			userId: "user-manager-1",
			name: "Katherine Johnson",
			pronouns: null,
			email: "katherine@example.com",
			image: "https://cdn.example.com/katherine.png",
			role: "manager",
			isFocused: undefined,
		},
		{
			...graph.nodes[0],
			id: "employee:emp-1",
			employeeId: "emp-1",
			userId: "user-1",
			name: "Ada Lovelace",
			image: null,
		},
	],
	edges: [
		{
			id: "manager:employee:manager-1->employee:emp-1",
			kind: "manager",
			source: "employee:manager-1",
			target: "employee:emp-1",
			label: "Manages",
		},
	],
};

function deferred<T>() {
	let resolve: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve: resolve! };
}

describe("OrgChartClient", () => {
	beforeEach(() => {
		searchMock.mockReset();
		employeeNeighborhoodMock.mockReset();
		teamNeighborhoodMock.mockReset();
	});

	it("renders an empty state when no nodes are available", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(
			<OrgChartClient initialGraph={{ ...graph, nodes: [], employeeCount: 0, partial: false }} />,
		);

		expect(screen.getByText("No active employees found")).toBeTruthy();
	});

	it("renders graph counts and partial loading notice", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		expect(screen.getByTestId("react-flow")).toBeTruthy();
		expect(screen.getByTestId("node-count").textContent).toBe("1");
		expect(screen.getByText("101 active employees")).toBeTruthy();
		expect(
			screen.getByText("Showing part of a large organization. Expand nodes or search to continue."),
		);
	});

	it("renders custom node controls and edge styles", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={teamGraph} />);

		expect(screen.getByText("Ada Lovelace (she/her)")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Expand Ada Lovelace (she/her) neighborhood" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Expand Platform team" })).toBeTruthy();
		expect(screen.getByTestId("edge-styles").textContent).toContain("strokeDasharray");
	});

	it("renders dark-mode friendly React Flow controls without a minimap", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		expect(screen.getByTestId("flow-controls").getAttribute("class")).toContain("bg-card");
		expect(screen.getByTestId("flow-controls").getAttribute("class")).toContain("stroke-current");
		expect(screen.getByTestId("flow-controls").getAttribute("data-position")).toBe("bottom-left");
		expect(screen.queryByTestId("flow-minimap")).toBeNull();
	});

	it("renders manager relationships and employee avatars with deterministic fallback", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={managerGraph} />);

		expect(screen.getByTestId("edge-count").textContent).toBe("1");
		expect(screen.getByTestId("edge-labels").textContent).toContain("Manages");
		expect(screen.getByRole("img", { name: "Katherine Johnson avatar" }).getAttribute("src")).toBe(
			"https://cdn.example.com/katherine.png",
		);
		expect(screen.getByRole("img", { name: "Ada Lovelace avatar" }).getAttribute("src")).toContain(
			"data:image/svg+xml",
		);
	});

	it("lets the org chart viewport fill the remaining screen height", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		expect(screen.getByTestId("react-flow").parentElement?.getAttribute("class")).toContain(
			"min-h-[calc(100dvh-18rem)]",
		);
	});

	it("searches employees and focuses the selected result", async () => {
		searchMock.mockResolvedValueOnce({
			success: true,
			data: [
				{
					employeeId: "emp-2",
					name: "Grace Hopper",
					pronouns: " she/her ",
					email: "grace@example.com",
					position: "Manager",
					image: null,
					role: "manager",
				},
			],
		});
		employeeNeighborhoodMock.mockResolvedValueOnce({
			success: true,
			data: {
				...graph,
				focusedEmployeeId: "emp-2",
				nodes: [
					{
						...graph.nodes[0],
						id: "employee:emp-2",
						employeeId: "emp-2",
						name: "Grace Hopper",
						pronouns: null,
						isFocused: true,
					},
				],
			},
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });
		expect(await screen.findByText("Grace Hopper (she/her)")).toBeTruthy();
		fireEvent.click(
			await screen.findByRole("button", { name: "Grace Hopper (she/her) grace@example.com" }),
		);

		await waitFor(() => expect(employeeNeighborhoodMock).toHaveBeenCalledWith("emp-2"));
	});

	it("preserves search result names when pronouns are absent", async () => {
		searchMock.mockResolvedValueOnce({
			success: true,
			data: [
				{
					employeeId: "emp-2",
					name: "Grace Hopper",
					pronouns: null,
					email: "grace@example.com",
					position: "Manager",
					image: null,
					role: "manager",
				},
			],
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });

		expect(await screen.findByText("Grace Hopper")).toBeTruthy();
		expect(screen.queryByText("Grace Hopper ()")).toBeNull();
	});

	it("ignores stale search responses after a newer query resolves", async () => {
		const firstSearch = deferred<{
			success: true;
			data: Array<{
				employeeId: string;
				name: string;
				pronouns: string | null;
				email: string;
				position: string | null;
				image: string | null;
				role: "admin" | "manager" | "employee";
			}>;
		}>();
		const secondSearch = deferred<{
			success: true;
			data: Array<{
				employeeId: string;
				name: string;
				pronouns: string | null;
				email: string;
				position: string | null;
				image: string | null;
				role: "admin" | "manager" | "employee";
			}>;
		}>();
		searchMock.mockReturnValueOnce(firstSearch.promise).mockReturnValueOnce(secondSearch.promise);

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Ad" } });
		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });

		secondSearch.resolve({
			success: true,
			data: [
				{
					employeeId: "emp-2",
					name: "Grace Hopper",
					pronouns: null,
					email: "grace@example.com",
					position: null,
					image: null,
					role: "manager",
				},
			],
		});
		expect(
			await screen.findByRole("button", { name: "Grace Hopper grace@example.com" }),
		).toBeTruthy();

		firstSearch.resolve({
			success: true,
			data: [
				{
					employeeId: "emp-3",
					name: "Stale Result",
					pronouns: null,
					email: "stale@example.com",
					position: null,
					image: null,
					role: "employee",
				},
			],
		});

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Stale Result stale@example.com" })).toBeNull(),
		);
	});

	it("does not repopulate search results after the query is cleared", async () => {
		const search = deferred<{
			success: true;
			data: Array<{
				employeeId: string;
				name: string;
				pronouns: string | null;
				email: string;
				position: string | null;
				image: string | null;
				role: "admin" | "manager" | "employee";
			}>;
		}>();
		searchMock.mockReturnValueOnce(search.promise);

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });
		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "" } });
		search.resolve({
			success: true,
			data: [
				{
					employeeId: "emp-2",
					name: "Grace Hopper",
					pronouns: null,
					email: "grace@example.com",
					position: null,
					image: null,
					role: "manager",
				},
			],
		});

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Grace Hopper grace@example.com" })).toBeNull(),
		);
	});

	it("expands an employee neighborhood and preserves existing graph nodes", async () => {
		employeeNeighborhoodMock.mockResolvedValueOnce({
			success: true,
			data: {
				...graph,
				nodes: [
					{
						...graph.nodes[0],
						id: "employee:emp-2",
						employeeId: "emp-2",
						name: "Grace Hopper",
						pronouns: null,
						email: "grace@example.com",
						isFocused: true,
					},
				],
			},
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.click(
			screen.getByRole("button", { name: "Expand Ada Lovelace (she/her) neighborhood" }),
		);

		await waitFor(() => expect(employeeNeighborhoodMock).toHaveBeenCalledWith("emp-1"));
		await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("2"));
		expect(screen.getByText("Ada Lovelace (she/her)")).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
	});

	it("expands a team neighborhood and preserves existing graph nodes", async () => {
		teamNeighborhoodMock.mockResolvedValueOnce({
			success: true,
			data: {
				...teamGraph,
				nodes: [
					{
						...graph.nodes[0],
						id: "employee:emp-2",
						employeeId: "emp-2",
						name: "Grace Hopper",
						pronouns: null,
						email: "grace@example.com",
					},
				],
			},
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={teamGraph} />);

		fireEvent.click(
			within(screen.getByTestId("flow-node-team:team-1")).getByRole("button", {
				name: "Expand Platform team",
			}),
		);

		await waitFor(() => expect(teamNeighborhoodMock).toHaveBeenCalledWith("team-1"));
		await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("3"));
		expect(screen.getByText("Ada Lovelace (she/her)")).toBeTruthy();
		expect(screen.getByText("Platform")).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
	});
});
