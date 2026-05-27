/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgChartGraph } from "./org-chart-types";

const { searchMock, employeeNeighborhoodMock, teamNeighborhoodMock, fitViewMock, setCenterMock } =
	vi.hoisted(() => ({
		searchMock: vi.fn(),
		employeeNeighborhoodMock: vi.fn(),
		teamNeighborhoodMock: vi.fn(),
		fitViewMock: vi.fn(),
		setCenterMock: vi.fn(),
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
	position?: {
		x: number;
		y: number;
	};
};

type MockFlowEdge = {
	id: string;
	label?: string;
	markerEnd?: { color?: string };
	sourceHandle?: string;
	type?: string;
	style?: Record<string, unknown>;
	targetHandle?: string;
};

vi.mock("@xyflow/react", () => ({
	Background: () => <div data-testid="flow-background" />,
	Controls: (props: { className?: string; position?: string }) => (
		<div data-position={props.position} data-testid="flow-controls" className={props.className} />
	),
	Handle: (props: {
		className?: string;
		id?: string;
		isConnectable?: boolean;
		position?: string;
		type: string;
	}) => (
		<div
			className={props.className}
			data-connectable={String(props.isConnectable ?? true)}
			data-handle-id={props.id}
			data-position={props.position}
			data-testid={`flow-handle-${props.type}-${props.id ?? props.position}`}
		/>
	),
	MiniMap: (props: {
		className?: string;
		position?: string;
		maskColor?: string;
		bgColor?: string;
	}) => (
		<div
			data-bg-color={props.bgColor}
			data-mask-color={props.maskColor}
			data-position={props.position}
			data-testid="flow-minimap"
			className={props.className}
		/>
	),
	MarkerType: { ArrowClosed: "arrowclosed" },
	Position: { Bottom: "bottom", Top: "top" },
	ReactFlow: ({
		nodes,
		edges,
		nodeTypes,
		fitView,
		fitViewOptions,
		minZoom,
		maxZoom,
		children,
	}: {
		nodes: MockFlowNode[];
		edges: MockFlowEdge[];
		nodeTypes: Record<string, (props: { data: unknown }) => ReactNode>;
		fitView?: boolean;
		fitViewOptions?: {
			padding?: number;
		};
		minZoom?: number;
		maxZoom?: number;
		children?: ReactNode;
	}) => (
		<div data-testid="react-flow">
			<div data-fit-view={fitView ? "true" : "false"} />
			<div data-fit-view-padding={fitViewOptions?.padding ?? ""} />
			<div data-min-zoom={minZoom ?? ""} />
			<div data-max-zoom={maxZoom ?? ""} />
			<div data-testid="node-count">{nodes.length}</div>
			<div data-testid="edge-count">{edges.length}</div>
			<div data-testid="edge-labels">{JSON.stringify(edges.map((edge) => edge.label))}</div>
			<div data-testid="edge-styles">{JSON.stringify(edges.map((edge) => edge.style))}</div>
			<div data-testid="edge-types">{JSON.stringify(edges.map((edge) => edge.type))}</div>
			<div data-testid="edge-handles">
				{JSON.stringify(
					edges.map((edge) => ({
						id: edge.id,
						sourceHandle: edge.sourceHandle,
						targetHandle: edge.targetHandle,
					})),
				)}
			</div>
			<div data-testid="edge-marker-colors">
				{JSON.stringify(edges.map((edge) => edge.markerEnd?.color))}
			</div>
			<div data-testid="node-positions">
				{JSON.stringify(nodes.map((node) => ({ id: node.id, position: node.position })))}
			</div>
			{nodes.map((node) => {
				const NodeComponent = nodeTypes[node.type ?? ""];

				return NodeComponent ? (
					<div
						data-testid={`flow-node-${node.id}`}
						data-node-x={node.position?.x}
						data-node-y={node.position?.y}
						key={node.id}
					>
						<NodeComponent data={node.data} />
					</div>
				) : null;
			})}
			{children}
		</div>
	),
	ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	useReactFlow: () => ({ fitView: fitViewMock, setCenter: setCenterMock }),
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
		{
			...graph.nodes[0],
			teamIds: ["team-1"],
		},
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

const hierarchyAndTeamGraph: OrgChartGraph = {
	...graph,
	focusedEmployeeId: "emp-1",
	nodes: [
		...graph.nodes,
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
			id: "team:team-1",
			kind: "team",
			teamId: "team-1",
			name: "Platform",
			description: null,
			memberCount: 12,
			primaryManagerId: "manager-1",
			expandable: { members: true, primaryManager: false },
		},
		{
			...graph.nodes[0],
			id: "team:team-2",
			kind: "team",
			teamId: "team-2",
			name: "Support",
			description: null,
			memberCount: 2,
			primaryManagerId: null,
			expandable: { members: true, primaryManager: false },
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
		{
			id: "team-membership:team:team-1->employee:emp-1",
			kind: "team-membership",
			source: "team:team-1",
			target: "employee:emp-1",
			label: "Member",
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
		fitViewMock.mockReset();
		setCenterMock.mockReset();
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
		expect(
			within(screen.getByTestId("flow-node-employee:emp-1")).getByText("Platform"),
		).toBeTruthy();
		expect(
			within(screen.getByTestId("flow-node-team:team-1")).getByTestId(
				"flow-handle-source-team-source",
			),
		).toBeTruthy();
		expect(screen.getByTestId("edge-handles").textContent).toContain(
			'"sourceHandle":"team-source"',
		);
		expect(screen.getByTestId("edge-handles").textContent).toContain(
			'"targetHandle":"manager-target"',
		);
		expect(screen.getByTestId("edge-styles").textContent).toContain("var(--muted-foreground)");
		expect(screen.getByTestId("edge-styles").textContent).not.toContain("hsl(var(");
		expect(screen.getByTestId("edge-marker-colors").textContent).toContain(
			"var(--muted-foreground)",
		);
		expect(screen.getByTestId("edge-marker-colors").textContent).not.toContain("hsl(var(");
		expect(screen.getByTestId("edge-styles").textContent).toContain("strokeDasharray");
		expect(screen.getByTestId("edge-types").textContent).toContain("smoothstep");
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
		expect(screen.getByTestId("edge-labels").textContent).not.toContain("Manages");
		expect(screen.getByRole("img", { name: "Katherine Johnson avatar" }).getAttribute("src")).toBe(
			"https://cdn.example.com/katherine.png",
		);
		expect(screen.getByRole("img", { name: "Ada Lovelace avatar" }).getAttribute("src")).toContain(
			"data:image/svg+xml",
		);

		const managerNode = screen.getByTestId("flow-node-employee:manager-1");
		expect(
			within(managerNode)
				.getByTestId("flow-handle-source-manager-source")
				.getAttribute("data-connectable"),
		).toBe("false");
		expect(
			within(managerNode)
				.getByTestId("flow-handle-target-manager-target")
				.getAttribute("data-connectable"),
		).toBe("false");

		const employeeNode = screen.getByTestId("flow-node-employee:emp-1");
		expect(
			within(employeeNode)
				.getByTestId("flow-handle-source-manager-source")
				.getAttribute("data-connectable"),
		).toBe("false");
		expect(
			within(employeeNode)
				.getByTestId("flow-handle-target-manager-target")
				.getAttribute("data-connectable"),
		).toBe("false");

		expect(screen.getByTestId("edge-handles").textContent).toContain(
			'"sourceHandle":"manager-source"',
		);
		expect(screen.getByTestId("edge-handles").textContent).toContain(
			'"targetHandle":"manager-target"',
		);

		const positions = JSON.parse(
			screen.getByTestId("node-positions").textContent ?? "[]",
		) as Array<{
			id: string;
			position: { x: number; y: number };
		}>;
		const managerPosition = positions.find((node) => node.id === "employee:manager-1")?.position;
		const employeePosition = positions.find((node) => node.id === "employee:emp-1")?.position;

		expect(managerPosition).toBeDefined();
		expect(employeePosition).toBeDefined();
		expect(managerPosition!.y).toBeLessThan(employeePosition!.y);
	});

	it("lets the org chart viewport fill the remaining screen height", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		expect(screen.getByTestId("react-flow").parentElement?.getAttribute("class")).toContain(
			"min-h-[calc(100dvh-18rem)]",
		);
	});

	it("orders hierarchical rows and pushes disconnected teams downward", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={hierarchyAndTeamGraph} />);

		const managerNode = screen.getByTestId("flow-node-employee:manager-1");
		const reportNode = screen.getByTestId("flow-node-employee:emp-1");
		const connectedTeamNode = screen.getByTestId("flow-node-team:team-1");
		const disconnectedTeamNode = screen.getByTestId("flow-node-team:team-2");

		const managerY = Number.parseFloat(managerNode.getAttribute("data-node-y") ?? "0");
		const reportY = Number.parseFloat(reportNode.getAttribute("data-node-y") ?? "0");
		const connectedTeamY = Number.parseFloat(connectedTeamNode.getAttribute("data-node-y") ?? "0");
		const disconnectedTeamY = Number.parseFloat(
			disconnectedTeamNode.getAttribute("data-node-y") ?? "0",
		);

		expect(managerY).toBeLessThan(reportY);
		expect(reportY).toBeLessThan(connectedTeamY);
		expect(connectedTeamY).toBeLessThan(disconnectedTeamY);
	});

	it("configures react flow to keep larger org charts visible", async () => {
		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		const flow = screen.getByTestId("react-flow");
		expect(flow.querySelector("[data-fit-view]")?.getAttribute("data-fit-view")).toBe("true");
		expect(
			flow.querySelector("[data-fit-view-padding]")?.getAttribute("data-fit-view-padding"),
		).toBe("0.18");
		expect(flow.querySelector("[data-min-zoom]")?.getAttribute("data-min-zoom")).toBe("0.2");
		expect(flow.querySelector("[data-max-zoom]")?.getAttribute("data-max-zoom")).toBe("1.5");
	});

	it("renders search results with avatars from the UserAvatar component", async () => {
		searchMock.mockResolvedValueOnce({
			success: true,
			data: [
				{
					employeeId: "emp-2",
					name: "Grace Hopper",
					pronouns: null,
					email: "grace@example.com",
					position: "Manager",
					image: "https://cdn.example.com/grace.png",
					role: "manager",
				},
			],
		});

		const { OrgChartClient } = await import("./org-chart-client");
		render(<OrgChartClient initialGraph={graph} />);

		fireEvent.change(screen.getByLabelText("Search employees"), { target: { value: "Grace" } });
		expect(await screen.findByRole("img", { name: "Grace Hopper avatar" })).toBeTruthy();
		expect(screen.getByText("Grace Hopper").parentElement?.className).toContain("flex-col");
	});

	it("centers closely on a searched and selected employee", async () => {
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
		fireEvent.click(await screen.findByRole("button", { name: "Grace Hopper grace@example.com" }));

		await waitFor(() => {
			expect(employeeNeighborhoodMock).toHaveBeenCalledWith("emp-2");
			expect(setCenterMock).toHaveBeenCalledWith(510, 70, {
				zoom: 1.05,
				duration: 240,
			});
			expect(fitViewMock).not.toHaveBeenCalledWith(
				expect.objectContaining({
					nodes: [expect.objectContaining({ id: "employee:emp-2" })],
				}),
			);
		});
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
		expect(within(screen.getByTestId("flow-node-team:team-1")).getByText("Platform")).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
	});
});
