"use client";

import {
	Background,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Edge,
	type Node,
	type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslate } from "@tolgee/react";
import { startTransition, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getEmployeeNeighborhood, getTeamNeighborhood, searchOrgEmployees } from "./actions";
import { mergeOrgChartGraphs } from "./org-chart-graph";
import type {
	OrgChartEdge,
	OrgChartEmployeeNode,
	OrgChartGraph,
	OrgChartNode,
	OrgChartSearchResult,
	OrgChartTeamNode,
} from "./org-chart-types";

type OrgChartClientProps = {
	initialGraph: OrgChartGraph;
};

type OrgChartFlowNodeData = {
	orgNode: OrgChartNode;
	onExpandEmployee: (employeeId: string) => void;
	onExpandTeam: (teamId: string) => void;
};

type OrgChartFlowNode = Node<OrgChartFlowNodeData>;

const NODE_WIDTH = 260;
const NODE_HEIGHT = 140;
const COLUMN_GAP = 120;
const ROW_GAP = 72;

const nodeTypes = {
	employee: EmployeeFlowNode,
	team: TeamFlowNode,
};

export function OrgChartClient({ initialGraph }: OrgChartClientProps) {
	return (
		<ReactFlowProvider>
			<OrgChartClientInner initialGraph={initialGraph} />
		</ReactFlowProvider>
	);
}

function OrgChartClientInner({ initialGraph }: OrgChartClientProps) {
	const { t } = useTranslate();
	const reactFlow = useReactFlow();
	const [graph, setGraph] = useState(initialGraph);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<OrgChartSearchResult[]>([]);
	const [statusText, setStatusText] = useState<string | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	const [isExpanding, setIsExpanding] = useState(false);

	const flowNodes = useMemo(
		() =>
			buildFlowNodes(graph.nodes, {
				onExpandEmployee: (employeeId) => {
					void expandEmployee(employeeId);
				},
				onExpandTeam: (teamId) => {
					void expandTeam(teamId);
				},
			}),
		[graph.nodes],
	);
	const flowEdges = useMemo(() => buildFlowEdges(graph.edges), [graph.edges]);

	useEffect(() => {
		if (flowNodes.length === 0) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			reactFlow.fitView({ padding: 0.18, duration: 240 });
		});

		return () => window.cancelAnimationFrame(frame);
	}, [flowNodes.length, reactFlow]);

	async function handleSearchChange(value: string) {
		setSearchQuery(value);
		setStatusText(null);

		const trimmedQuery = value.trim();
		if (trimmedQuery.length < 2) {
			setSearchResults([]);
			return;
		}

		setIsSearching(true);
		const result = await searchOrgEmployees(trimmedQuery);
		setIsSearching(false);

		if (!result.success) {
			showFailure(result.error || t("organization.orgChart.searchFailed", "Could not search employees."));
			setSearchResults([]);
			return;
		}

		setSearchResults(result.data);
	}

	async function focusEmployee(employeeId: string) {
		setStatusText(null);
		const result = await getEmployeeNeighborhood(employeeId);

		if (!result.success) {
			showFailure(result.error || t("organization.orgChart.focusFailed", "Could not load employee details."));
			return;
		}

		startTransition(() => {
			setGraph((currentGraph) => mergeOrgChartGraphs(currentGraph, result.data, employeeId));
			setSearchQuery("");
			setSearchResults([]);
		});
	}

	async function expandEmployee(employeeId: string) {
		setStatusText(null);
		setIsExpanding(true);
		const result = await getEmployeeNeighborhood(employeeId);
		setIsExpanding(false);

		if (!result.success) {
			showFailure(result.error || t("organization.orgChart.expandEmployeeFailed", "Could not expand employee."));
			return;
		}

		startTransition(() => {
			setGraph((currentGraph) => mergeOrgChartGraphs(currentGraph, result.data, employeeId));
		});
	}

	async function expandTeam(teamId: string) {
		setStatusText(null);
		setIsExpanding(true);
		const result = await getTeamNeighborhood(teamId);
		setIsExpanding(false);

		if (!result.success) {
			showFailure(result.error || t("organization.orgChart.expandTeamFailed", "Could not expand team."));
			return;
		}

		startTransition(() => {
			setGraph((currentGraph) => mergeOrgChartGraphs(currentGraph, result.data, currentGraph.focusedEmployeeId));
		});
	}

	function showFailure(message: string) {
		setStatusText(message);
		toast.error(message);
	}

	if (graph.nodes.length === 0) {
		return (
			<section className="flex min-h-[520px] items-center justify-center rounded-lg border bg-card text-card-foreground">
				<p className="text-sm text-muted-foreground">
					{t("organization.orgChart.empty", "No active employees found")}
				</p>
			</section>
		);
	}

	return (
		<section className="space-y-3">
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm md:flex-row md:items-start md:justify-between">
				<div>
					<p className="text-sm font-medium">{t("organization.orgChart.explorer", "Org Chart Explorer")}</p>
					<p className="text-sm text-muted-foreground">
						{t("organization.orgChart.employeeCount", "{count} active employees").replace(
							"{count}",
							new Intl.NumberFormat().format(graph.employeeCount),
						)}
					</p>
				</div>
				<div className="relative w-full md:max-w-sm">
					<input
						aria-label="Search employees"
						className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
						autoComplete="off"
						name="org-chart-employee-search"
						onChange={(event) => {
							void handleSearchChange(event.target.value);
						}}
						placeholder={t("organization.orgChart.searchPlaceholder", "Search employees…")}
						value={searchQuery}
					/>
					{searchQuery.trim().length >= 2 ? (
						<div className="absolute right-0 left-0 z-20 mt-2 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
							{isSearching ? (
								<p className="px-3 py-2 text-sm text-muted-foreground" role="status">
									{t("organization.orgChart.searching", "Searching…")}
								</p>
							) : null}
							{searchResults.map((result) => (
								<button
									aria-label={`${result.name} ${result.email}`}
									className="flex w-full flex-col items-start px-3 py-2 text-left text-sm outline-none transition hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
									key={result.employeeId}
									onClick={() => {
										void focusEmployee(result.employeeId);
									}}
									type="button"
								>
									<span className="font-medium">{result.name}</span>
									<span className="text-muted-foreground">{result.email}</span>
								</button>
							))}
							{!isSearching && searchResults.length === 0 ? (
								<p className="px-3 py-2 text-sm text-muted-foreground">
									{t("organization.orgChart.noSearchResults", "No employees found")}
								</p>
							) : null}
						</div>
					) : null}
				</div>
			</div>

			{graph.partial ? (
				<p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					Showing part of a large organization. Expand nodes or search to continue.
				</p>
			) : null}
			{statusText ? (
				<p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="status">
					{statusText}
				</p>
			) : null}
			{isExpanding ? (
				<p className="sr-only" role="status">
					{t("organization.orgChart.expanding", "Loading more organization data")}
				</p>
			) : null}

			<div className="h-[680px] overflow-hidden rounded-lg border bg-background">
				<ReactFlow
					edges={flowEdges}
					fitView
					nodeTypes={nodeTypes}
					nodes={flowNodes}
					proOptions={{ hideAttribution: true }}
				>
					<Background />
					<Controls />
					<MiniMap pannable zoomable />
				</ReactFlow>
			</div>
		</section>
	);
}

function buildFlowNodes(
	nodes: OrgChartNode[],
	handlers: Pick<OrgChartFlowNodeData, "onExpandEmployee" | "onExpandTeam">,
): OrgChartFlowNode[] {
	const orderedNodes = [...nodes].sort((first, second) => {
		if (first.kind !== second.kind) {
			return first.kind === "employee" ? -1 : 1;
		}

		return first.id.localeCompare(second.id);
	});

	return orderedNodes.map((node, index) => {
		const column = index % 4;
		const row = Math.floor(index / 4);

		return {
			id: node.id,
			type: node.kind,
			position: {
				x: column * (NODE_WIDTH + COLUMN_GAP),
				y: row * (NODE_HEIGHT + ROW_GAP) + (node.kind === "team" ? NODE_HEIGHT / 2 : 0),
			},
			data: {
				orgNode: node,
				...handlers,
			},
		};
	});
}

function buildFlowEdges(edges: OrgChartEdge[]): Edge[] {
	return edges.map((edge) => ({
		id: edge.id,
		label: edge.label,
		source: edge.source,
		target: edge.target,
		style: getEdgeStyle(edge),
		animated: edge.kind === "team-primary-manager",
	}));
}

function getEdgeStyle(edge: OrgChartEdge): Edge["style"] {
	if (edge.kind === "team-membership") {
		return {
			stroke: "hsl(var(--muted-foreground))",
			strokeDasharray: "6 5",
			strokeWidth: 1.5,
		};
	}

	if (edge.kind === "team-primary-manager") {
		return {
			stroke: "hsl(var(--accent-foreground))",
			strokeWidth: 2,
		};
	}

	return {
		stroke: "hsl(var(--primary))",
		strokeWidth: 2,
	};
}

function EmployeeFlowNode({ data }: NodeProps<OrgChartFlowNode>) {
	const node = data.orgNode as OrgChartEmployeeNode;
	const canExpand = node.expandable.managers || node.expandable.reports || node.expandable.teams;

	return (
		<div
			className={`w-[260px] rounded-xl border bg-card p-4 text-card-foreground shadow-sm ${
				node.isFocused ? "border-primary ring-2 ring-primary/30" : "border-border"
			}`}
		>
			<div className="flex items-start gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
					{getInitials(node.name)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold">{node.name}</p>
					<p className="truncate text-xs text-muted-foreground">{node.email}</p>
					{node.position ? <p className="mt-1 truncate text-xs text-muted-foreground">{node.position}</p> : null}
				</div>
			</div>
			<div className="mt-3 flex items-center justify-between gap-2">
				<span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground capitalize">
					{node.role}
				</span>
				{canExpand ? (
					<button
						className="rounded-md border px-2 py-1 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
						onClick={() => data.onExpandEmployee(node.employeeId)}
						type="button"
					>
						Expand
					</button>
				) : null}
			</div>
		</div>
	);
}

function TeamFlowNode({ data }: NodeProps<OrgChartFlowNode>) {
	const node = data.orgNode as OrgChartTeamNode;
	const canExpand = node.expandable.members || node.expandable.primaryManager;

	return (
		<div className="w-[260px] rounded-xl border bg-muted/40 p-4 text-card-foreground shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold">{node.name}</p>
					<p className="mt-1 text-xs text-muted-foreground">{node.memberCount} members</p>
				</div>
				<span className="rounded-full bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
					Team
				</span>
			</div>
			{node.description ? <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{node.description}</p> : null}
			{canExpand ? (
				<button
					className="mt-3 rounded-md border bg-background px-2 py-1 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
					onClick={() => data.onExpandTeam(node.teamId)}
					type="button"
				>
					Expand team
				</button>
			) : null}
		</div>
	);
}

function getInitials(name: string) {
	return name
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}
