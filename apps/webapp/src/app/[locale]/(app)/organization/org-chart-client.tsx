"use client";

import {
	Background,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslate } from "@tolgee/react";
import { startTransition, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { normalizePronouns } from "@/lib/employee-identity";
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

const NUMBER_FORMAT = new Intl.NumberFormat();

type OrgChartClientProps = {
	initialGraph: OrgChartGraph;
};

type OrgChartFlowNodeData = {
	orgNode: OrgChartNode;
	onExpandEmployee: (employeeId: string) => void;
	onExpandTeam: (teamId: string) => void;
	teamNamesById: Map<string, string>;
};

type OrgChartFlowNode = Node<OrgChartFlowNodeData>;

const NODE_WIDTH = 260;
const NODE_HEIGHT = 140;
const COLUMN_GAP = 120;
const ROW_GAP = 72;
const FLOW_PADDING = 0.18;
const FLOW_MIN_ZOOM = 0.2;
const FLOW_MAX_ZOOM = 1.5;
const FLOW_SEARCH_FOCUS_ZOOM = 1.05;
const FLOW_WIDGET_CLASSNAME =
	"border border-border bg-card text-card-foreground shadow-sm [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:text-card-foreground [&_.react-flow__controls-button:hover]:bg-accent [&_.react-flow__controls-button:hover]:text-accent-foreground [&_.react-flow__controls-button_path]:stroke-current [&_.react-flow__controls-button_svg]:fill-current [&_.react-flow__controls-button_svg]:stroke-current";

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
	const [focusedEmployeeFromSearchId, setFocusedEmployeeFromSearchId] = useState<string | null>(
		null,
	);
	const searchRequestSequence = useRef(0);
	const skipNextFitViewRef = useRef(false);

	const flowNodes = buildFlowNodes(graph.nodes, graph.edges, {
		onExpandEmployee: (employeeId: string) => {
			void expandEmployee(employeeId);
		},
		onExpandTeam: (teamId: string) => {
			void expandTeam(teamId);
		},
	});
	const flowEdges = buildFlowEdges(graph.edges);

	useEffect(() => {
		if (flowNodes.length === 0) {
			return;
		}

		if (skipNextFitViewRef.current) {
			skipNextFitViewRef.current = false;
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			reactFlow.fitView({ padding: FLOW_PADDING, duration: 240 });
		});

		return () => window.cancelAnimationFrame(frame);
	}, [flowNodes.length, reactFlow]);

	useEffect(() => {
		if (!focusedEmployeeFromSearchId) {
			return;
		}

		const focusNode = flowNodes.find(
			(node) =>
				node.type === "employee" &&
				node.data.orgNode.kind === "employee" &&
				node.data.orgNode.employeeId === focusedEmployeeFromSearchId,
		);

		if (!focusNode) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			reactFlow.setCenter(
				focusNode.position.x + NODE_WIDTH / 2,
				focusNode.position.y + NODE_HEIGHT / 2,
				{
					zoom: FLOW_SEARCH_FOCUS_ZOOM,
					duration: 240,
				},
			);
			setFocusedEmployeeFromSearchId(null);
		});

		return () => window.cancelAnimationFrame(frame);
	}, [focusedEmployeeFromSearchId, flowNodes, reactFlow]);

	async function handleSearchChange(value: string) {
		setSearchQuery(value);
		setStatusText(null);

		const trimmedQuery = value.trim();
		if (trimmedQuery.length < 2) {
			searchRequestSequence.current += 1;
			setSearchResults([]);
			setIsSearching(false);
			return;
		}

		const requestSequence = searchRequestSequence.current + 1;
		searchRequestSequence.current = requestSequence;
		setIsSearching(true);
		const result = await searchOrgEmployees(trimmedQuery);
		const isLatestRequest = requestSequence === searchRequestSequence.current;

		if (!isLatestRequest) {
			return;
		}

		setIsSearching(false);

		if (!result.success) {
			showFailure(
				result.error || t("organization.orgChart.searchFailed", "Could not search employees."),
			);
			setSearchResults([]);
			return;
		}

		setSearchResults(result.data);
	}

	async function focusEmployee(employeeId: string) {
		setStatusText(null);
		const result = await getEmployeeNeighborhood(employeeId);

		if (!result.success) {
			showFailure(
				result.error || t("organization.orgChart.focusFailed", "Could not load employee details."),
			);
			return;
		}

		startTransition(() => {
			skipNextFitViewRef.current = true;
			setGraph((currentGraph) => mergeOrgChartGraphs(currentGraph, result.data, employeeId));
			setSearchQuery("");
			setSearchResults([]);
			setFocusedEmployeeFromSearchId(employeeId);
		});
	}

	async function expandEmployee(employeeId: string) {
		setStatusText(null);
		setIsExpanding(true);
		const result = await getEmployeeNeighborhood(employeeId);
		setIsExpanding(false);

		if (!result.success) {
			showFailure(
				result.error ||
					t("organization.orgChart.expandEmployeeFailed", "Could not expand employee."),
			);
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
			showFailure(
				result.error || t("organization.orgChart.expandTeamFailed", "Could not expand team."),
			);
			return;
		}

		startTransition(() => {
			setGraph((currentGraph) =>
				mergeOrgChartGraphs(currentGraph, result.data, currentGraph.focusedEmployeeId),
			);
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
					<p className="text-sm font-medium">
						{t("organization.orgChart.explorer", "Org Chart Explorer")}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("organization.orgChart.employeeCount", "{count} active employees", {
							count: NUMBER_FORMAT.format(graph.employeeCount),
						})}
					</p>
				</div>
				<div className="relative w-full md:max-w-sm">
					<input
						aria-label={t("organization.orgChart.searchLabel", "Search employees")}
						className="h-10 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
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
							{searchResults.map((result) => {
								const pronouns = normalizePronouns(result.pronouns);
								const displayName = pronouns ? `${result.name} (${pronouns})` : result.name;

								return (
									<button
										aria-label={`${displayName} ${result.email}`}
										className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
										key={result.employeeId}
										onClick={() => {
											void focusEmployee(result.employeeId);
										}}
										type="button"
									>
										<UserAvatar
											clockStatus="unknown"
											image={result.image}
											name={result.name}
											seed={result.employeeId}
											size="sm"
											className="border border-border bg-primary/10"
										/>
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="font-medium">{displayName}</span>
											<span className="text-muted-foreground">{result.email}</span>
										</div>
									</button>
								);
							})}
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
					{t(
						"organization.orgChart.partialGraph",
						"Showing part of a large organization. Expand nodes or search to continue.",
					)}
				</p>
			) : null}
			{statusText ? (
				<p
					className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					role="status"
				>
					{statusText}
				</p>
			) : null}
			{isExpanding ? (
				<p className="sr-only" role="status">
					{t("organization.orgChart.expanding", "Loading more organization data")}
				</p>
			) : null}

			<div className="h-[680px] min-h-[calc(100dvh-18rem)] overflow-hidden rounded-lg border bg-background">
				<ReactFlow
					edges={flowEdges}
					fitViewOptions={{ padding: FLOW_PADDING }}
					fitView
					maxZoom={FLOW_MAX_ZOOM}
					nodeTypes={nodeTypes}
					nodes={flowNodes}
					minZoom={FLOW_MIN_ZOOM}
					proOptions={{ hideAttribution: true }}
				>
					<Background />
					<Controls className={FLOW_WIDGET_CLASSNAME} position="bottom-left" />
				</ReactFlow>
			</div>
		</section>
	);
}

function buildFlowNodes(
	nodes: OrgChartNode[],
	edges: OrgChartEdge[],
	handlers: Pick<OrgChartFlowNodeData, "onExpandEmployee" | "onExpandTeam">,
): OrgChartFlowNode[] {
	const rowsByNode = buildHierarchyRows(nodes, edges);
	const nodesByRow = new Map<number, OrgChartNode[]>();
	const teamNamesById = new Map(
		nodes
			.filter((node): node is OrgChartTeamNode => node.kind === "team")
			.map((node) => [node.teamId, node.name]),
	);

	for (const node of nodes) {
		const row = rowsByNode.get(node.id) ?? 0;
		const rowNodes = nodesByRow.get(row);
		if (rowNodes) {
			rowNodes.push(node);
		} else {
			nodesByRow.set(row, [node]);
		}
	}

	const rowIndices = Array.from(nodesByRow.keys()).toSorted((first, second) => first - second);

	return rowIndices.flatMap((row) => {
		const sortedRowNodes = (nodesByRow.get(row) ?? []).toSorted((first, second) => {
			if (first.kind !== second.kind) {
				return first.kind === "employee" ? -1 : 1;
			}

			return first.id.localeCompare(second.id);
		});

		return sortedRowNodes.map((node, column) => {
			return {
				id: node.id,
				type: node.kind,
				position: {
					x: column * (NODE_WIDTH + COLUMN_GAP),
					y: row * (NODE_HEIGHT + ROW_GAP) + (node.kind === "team" ? NODE_HEIGHT / 2 : 0),
				},
				data: {
					orgNode: node,
					teamNamesById,
					...handlers,
				},
			};
		});
	});
}

function buildHierarchyRows(nodes: OrgChartNode[], edges: OrgChartEdge[]): Map<string, number> {
	const employeeNodes = nodes.filter((node) => node.kind === "employee");
	const employeeRows = new Map<string, number>();
	const managerChildren = new Map<string, string[]>();
	const incomingManagers = new Map<string, string[]>();

	for (const edge of edges) {
		if (edge.kind !== "manager") {
			continue;
		}

		if (!edge.source || !edge.target) {
			continue;
		}

		managerChildren.set(edge.source, [...(managerChildren.get(edge.source) ?? []), edge.target]);
		incomingManagers.set(edge.target, [...(incomingManagers.get(edge.target) ?? []), edge.source]);
	}

	const roots = employeeNodes
		.filter((node) => !incomingManagers.has(node.id))
		.sort((first, second) => first.id.localeCompare(second.id));

	const queue = roots.map((root) => root.id);
	const visited = new Set<string>(queue);
	const fallbackRows = new Map<string, number>();

	for (const rootId of queue) {
		employeeRows.set(rootId, 0);
	}

	while (queue.length > 0) {
		const source = queue.shift();
		if (!source) {
			break;
		}

		const row = employeeRows.get(source) ?? 0;
		for (const target of managerChildren
			.get(source)
			?.toSorted((first, second) => first.localeCompare(second)) ?? []) {
			const nextRow = row + 1;
			const previousRow = employeeRows.get(target);

			if (previousRow === undefined || nextRow > previousRow) {
				employeeRows.set(target, nextRow);
				queue.push(target);
				if (!visited.has(target)) {
					visited.add(target);
				}
			}
		}
	}

	for (const node of employeeNodes) {
		if (employeeRows.has(node.id)) {
			continue;
		}

		if (incomingManagers.has(node.id) || visited.has(node.id)) {
			fallbackRows.set(node.id, fallbackRows.size);
		} else {
			employeeRows.set(node.id, 0);
		}
	}

	let maxEmployeeRow = -1;
	for (const row of employeeRows.values()) {
		maxEmployeeRow = Math.max(maxEmployeeRow, row);
	}

	for (const [employeeId, row] of fallbackRows) {
		employeeRows.set(employeeId, maxEmployeeRow + row + 1);
	}

	const teamRows = new Map<string, number>();
	const disconnectedTeamRows = new Set<string>();

	for (const edge of edges) {
		if (edge.kind === "team-membership") {
			const targetRow = employeeRows.get(edge.target);
			if (targetRow === undefined) {
				continue;
			}

			teamRows.set(edge.source, Math.max(teamRows.get(edge.source) ?? -Infinity, targetRow + 1));
		}

		if (edge.kind === "team-primary-manager") {
			const sourceRow = employeeRows.get(edge.source);
			if (sourceRow === undefined) {
				continue;
			}

			teamRows.set(edge.target, Math.max(teamRows.get(edge.target) ?? -Infinity, sourceRow + 1));
		}
	}

	for (const node of nodes) {
		if (node.kind !== "team") {
			continue;
		}

		if (!teamRows.has(node.id)) {
			disconnectedTeamRows.add(node.id);
		}
	}

	if (disconnectedTeamRows.size > 0) {
		const fallbackRow = Math.max(maxEmployeeRow, ...teamRows.values(), 0) + 1;
		for (const teamId of disconnectedTeamRows) {
			teamRows.set(teamId, fallbackRow);
		}
	}

	for (const [teamId, teamRow] of teamRows.entries()) {
		employeeRows.set(teamId, teamRow);
	}

	return employeeRows;
}

function buildFlowEdges(edges: OrgChartEdge[]): Edge[] {
	return edges.map((edge) => ({
		id: edge.id,
		type: "smoothstep",
		source: edge.source,
		sourceHandle: getEdgeSourceHandle(edge),
		target: edge.target,
		targetHandle: getEdgeTargetHandle(edge),
		style: getEdgeStyle(edge),
		markerEnd: {
			type: MarkerType.ArrowClosed,
			color: edge.kind === "team-membership" ? "var(--muted-foreground)" : "var(--primary)",
		},
		animated: edge.kind === "team-primary-manager",
	}));
}

function getEdgeSourceHandle(edge: OrgChartEdge) {
	return edge.kind === "team-membership" ? "team-source" : "manager-source";
}

function getEdgeTargetHandle(edge: OrgChartEdge) {
	return edge.kind === "team-primary-manager" ? "team-target" : "manager-target";
}

function getEdgeStyle(edge: OrgChartEdge): Edge["style"] {
	if (edge.kind === "team-membership") {
		return {
			stroke: "var(--muted-foreground)",
			strokeDasharray: "6 5",
			strokeWidth: 1.5,
		};
	}

	if (edge.kind === "team-primary-manager") {
		return {
			stroke: "var(--accent-foreground)",
			strokeWidth: 2,
		};
	}

	return {
		stroke: "var(--primary)",
		strokeWidth: 2,
	};
}

function EmployeeFlowNode({ data }: NodeProps<OrgChartFlowNode>) {
	const { t } = useTranslate();
	const node = data.orgNode as OrgChartEmployeeNode;
	const canExpand = node.expandable.managers || node.expandable.reports || node.expandable.teams;
	const pronouns = normalizePronouns(node.pronouns);
	const displayName = pronouns ? `${node.name} (${pronouns})` : node.name;
	const teamNames = node.teamIds.flatMap((teamId) => {
		const teamName = data.teamNamesById.get(teamId);

		return teamName ? [teamName] : [];
	});

	return (
		<div
			className={`relative w-[260px] rounded-xl border bg-card p-4 text-card-foreground shadow-sm ${
				node.isFocused ? "border-primary ring-2 ring-primary/30" : "border-border"
			}`}
		>
			<Handle
				className="border border-primary/40 bg-primary"
				id="manager-target"
				isConnectable={false}
				position={Position.Top}
				type="target"
			/>
			<Handle
				className="border border-primary/40 bg-primary"
				id="manager-source"
				isConnectable={false}
				position={Position.Bottom}
				type="source"
			/>
			<div className="flex items-start gap-3">
				<UserAvatar
					className="border border-border bg-primary/10"
					clockStatus="unknown"
					image={node.image}
					name={node.name}
					seed={node.userId || node.employeeId}
					size="md"
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold">{displayName}</p>
					<p className="truncate text-xs text-muted-foreground">{node.email}</p>
					{node.position ? (
						<p className="mt-1 truncate text-xs text-muted-foreground">{node.position}</p>
					) : null}
				</div>
			</div>
			<div className="mt-3 flex items-center justify-between gap-2">
				<div className="flex min-w-0 flex-wrap gap-1.5">
					<span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground capitalize">
						{node.role}
					</span>
					{teamNames.map((teamName) => (
						<span
							className="max-w-[150px] truncate rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary"
							key={teamName}
							title={teamName}
						>
							{teamName}
						</span>
					))}
				</div>
				{canExpand ? (
					<button
						aria-label={t(
							"organization.orgChart.expandEmployeeLabel",
							"Expand {name} neighborhood",
							{
								name: displayName,
							},
						)}
						className="rounded-md border px-2 py-1 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
						onClick={() => data.onExpandEmployee(node.employeeId)}
						type="button"
					>
						{t("organization.orgChart.expand", "Expand")}
					</button>
				) : null}
			</div>
		</div>
	);
}

function TeamFlowNode({ data }: NodeProps<OrgChartFlowNode>) {
	const { t } = useTranslate();
	const node = data.orgNode as OrgChartTeamNode;
	const canExpand = node.expandable.members || node.expandable.primaryManager;

	return (
		<div className="relative w-[260px] rounded-xl border bg-muted/40 p-4 text-card-foreground shadow-sm">
			<Handle
				className="border border-muted-foreground/40 bg-muted-foreground"
				id="team-target"
				isConnectable={false}
				position={Position.Top}
				type="target"
			/>
			<Handle
				className="border border-muted-foreground/40 bg-muted-foreground"
				id="team-source"
				isConnectable={false}
				position={Position.Bottom}
				type="source"
			/>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold">{node.name}</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{t("organization.orgChart.memberCount", "{count} members", {
							count: node.memberCount,
						})}
					</p>
				</div>
				<span className="rounded-full bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
					{t("organization.orgChart.teamBadge", "Team")}
				</span>
			</div>
			{node.description ? (
				<p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{node.description}</p>
			) : null}
			{canExpand ? (
				<button
					aria-label={t("organization.orgChart.expandTeamLabel", "Expand {name} team", {
						name: node.name,
					})}
					className="mt-3 rounded-md border bg-background px-2 py-1 text-xs font-medium transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
					onClick={() => data.onExpandTeam(node.teamId)}
					type="button"
				>
					{t("organization.orgChart.expandTeam", "Expand team")}
				</button>
			) : null}
		</div>
	);
}
