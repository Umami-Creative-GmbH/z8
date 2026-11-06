"use client";

import {
	IconChevronDown,
	IconChevronRight,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	Background,
	Controls,
	type Edge,
	Handle,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	layoutReportingTree,
	PERSON_CARD_HEIGHT,
	PERSON_CARD_WIDTH,
} from "./org-explorer-layout";
import {
	PersonAvatar,
	PersonButton,
	personDisplayName,
	TeamChips,
} from "./org-explorer-person";
import { type ReportingTree, visibleTreeIds } from "./org-explorer-tree";
import type { OrgExplorerPerson } from "./org-explorer-types";

export type CenterRequest = { employeeId: string; nonce: number };

/** How a person shows while the team filter is on. */
export type Highlight = "none" | "match" | "path" | "dimmed";

export type ReportingLinesProps = {
	tree: ReportingTree;
	peopleById: ReadonlyMap<string, OrgExplorerPerson>;
	teamNamesById: ReadonlyMap<string, string>;
	openIds: ReadonlySet<string>;
	highlightOf: (employeeId: string) => Highlight;
	selectedId: string | null;
	loadingIds: ReadonlySet<string>;
	/** The person to centre on once they are laid out. A new nonce asks again. */
	centerRequest: CenterRequest | null;
	onSelect: (employeeId: string) => void;
	onToggle: (employeeId: string) => void;
};

type PersonNodeData = {
	person: OrgExplorerPerson;
	isOpen: boolean;
	isLoading: boolean;
	isSelected: boolean;
	highlight: Highlight;
	teamNamesById: ReadonlyMap<string, string>;
	onSelect: (employeeId: string) => void;
	onToggle: (employeeId: string) => void;
};

type PersonFlowNode = Node<PersonNodeData, "person">;

const FLOW_PADDING = 0.18;
const FLOW_MIN_ZOOM = 0.2;
const FLOW_MAX_ZOOM = 1.5;
const FLOW_CENTER_ZOOM = 1.05;
const FLOW_CONTROLS_CLASSNAME =
	"border border-border bg-card text-card-foreground shadow-sm [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:text-card-foreground [&_.react-flow__controls-button:hover]:bg-accent [&_.react-flow__controls-button:hover]:text-accent-foreground [&_.react-flow__controls-button_svg]:fill-current";

const nodeTypes = { person: PersonFlowCard };

/** The reporting lines as a pan-and-zoom tree of cards. */
export function ReportingLinesCanvas(props: ReportingLinesProps) {
	const { t } = useTranslate();
	const reactFlow = useReactFlow();
	const visibleIds = visibleTreeIds(props.tree, props.openIds);
	const layout = layoutReportingTree(props.tree, visibleIds);

	const nodes = visibleIds.flatMap<PersonFlowNode>((id) => {
		const person = props.peopleById.get(id);
		const position = layout.positions.get(id);
		if (!person || !position) return [];
		return [
			{
				id,
				type: "person",
				position,
				draggable: false,
				connectable: false,
				data: {
					person,
					isOpen: props.openIds.has(id),
					isLoading: props.loadingIds.has(id),
					isSelected: props.selectedId === id,
					highlight: props.highlightOf(id),
					teamNamesById: props.teamNamesById,
					onSelect: props.onSelect,
					onToggle: props.onToggle,
				},
			},
		];
	});
	const edges = layout.edges.map<Edge>((edge) => ({
		id: `${edge.source}->${edge.target}`,
		source: edge.source,
		target: edge.target,
		type: "smoothstep",
		style: {
			stroke: "var(--muted-foreground)",
			strokeWidth: 1.5,
			opacity: props.highlightOf(edge.target) === "dimmed" ? 0.3 : 0.7,
		},
	}));

	const centerRequest = props.centerRequest;
	const centerPosition = centerRequest
		? layout.positions.get(centerRequest.employeeId)
		: undefined;
	const centerX = centerPosition?.x;
	const centerY = centerPosition?.y;
	const centeredNonce = useRef<number | null>(null);
	useEffect(() => {
		if (!centerRequest || centerX === undefined || centerY === undefined)
			return;
		if (centeredNonce.current === centerRequest.nonce) return;
		const frame = window.requestAnimationFrame(() => {
			centeredNonce.current = centerRequest.nonce;
			reactFlow.setCenter(
				centerX + PERSON_CARD_WIDTH / 2,
				centerY + PERSON_CARD_HEIGHT / 2,
				{
					zoom: FLOW_CENTER_ZOOM,
					duration: 240,
				},
			);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [centerRequest, centerX, centerY, reactFlow]);

	return (
		<div className="h-[640px] min-h-[calc(100dvh-20rem)] overflow-hidden rounded-lg border bg-background">
			<ReactFlow
				aria-label={t(
					"organization.explorer.reportingLines",
					"Reporting lines",
				)}
				edges={edges}
				elementsSelectable={false}
				fitView
				fitViewOptions={{ padding: FLOW_PADDING }}
				maxZoom={FLOW_MAX_ZOOM}
				minZoom={FLOW_MIN_ZOOM}
				nodes={nodes}
				nodesConnectable={false}
				nodesDraggable={false}
				nodeTypes={nodeTypes}
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls
					className={FLOW_CONTROLS_CLASSNAME}
					position="bottom-left"
					showInteractive={false}
				/>
			</ReactFlow>
		</div>
	);
}

function PersonFlowCard({ data }: NodeProps<PersonFlowNode>) {
	const { t } = useTranslate();
	const { person } = data;
	const otherManagers = person.managerIds.length - 1;

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground shadow-sm transition-opacity",
				data.isSelected && "border-primary ring-2 ring-primary/30",
				data.highlight === "match" && "border-primary bg-primary/5",
				data.highlight === "dimmed" && "opacity-40",
			)}
			data-highlight={data.highlight}
			data-testid={`org-person-${person.employeeId}`}
			style={{ width: PERSON_CARD_WIDTH, height: PERSON_CARD_HEIGHT }}
		>
			<Handle
				className="opacity-0"
				isConnectable={false}
				position={Position.Top}
				type="target"
			/>
			<button
				className="-m-1 flex min-w-0 items-center gap-3 rounded-md p-1 text-left outline-none transition hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => data.onSelect(person.employeeId)}
				type="button"
			>
				<PersonAvatar person={person} size="md" />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-sm font-semibold">
						{personDisplayName(person)}
					</span>
					{person.position ? (
						<span className="truncate text-xs text-muted-foreground">
							{person.position}
						</span>
					) : null}
				</span>
			</button>
			<TeamChips person={person} teamNamesById={data.teamNamesById} />
			<div className="mt-auto flex items-center justify-between gap-2">
				{otherManagers > 0 ? (
					<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
						<IconUsers aria-hidden="true" className="size-3.5" />
						{t(
							"organization.explorer.otherManagers",
							"{count, plural, one {+# manager} other {+# managers}}",
							{ count: otherManagers },
						)}
					</span>
				) : (
					<span />
				)}
				<DirectReportsToggle
					isLoading={data.isLoading}
					isOpen={data.isOpen}
					onToggle={data.onToggle}
					person={person}
				/>
			</div>
			<Handle
				className="opacity-0"
				isConnectable={false}
				position={Position.Bottom}
				type="source"
			/>
		</div>
	);
}

/** The direct-report count, which opens and closes the subtree below a person. */
function DirectReportsToggle({
	person,
	isOpen,
	isLoading,
	onToggle,
}: {
	person: OrgExplorerPerson;
	isOpen: boolean;
	isLoading: boolean;
	onToggle: (employeeId: string) => void;
}) {
	const { t } = useTranslate();
	const count = person.lineReportIds.length;
	if (count === 0) return null;
	const Icon = isOpen ? IconChevronDown : IconChevronRight;

	return (
		<Button
			aria-busy={isLoading || undefined}
			aria-expanded={isOpen}
			className="h-7 gap-1 px-2 text-xs"
			onClick={() => onToggle(person.employeeId)}
			size="sm"
			type="button"
			variant="ghost"
		>
			<Icon aria-hidden="true" className="size-3.5" />
			{t(
				"organization.explorer.directReports",
				"{count, plural, one {# direct report} other {# direct reports}}",
				{ count },
			)}
		</Button>
	);
}

/**
 * The reporting lines as an indented outline, for phones. Each direct-report
 * count is a disclosure button that opens the subtree below it.
 */
export function ReportingLinesOutline(props: ReportingLinesProps) {
	const { t } = useTranslate();

	return (
		<ul
			aria-label={t("organization.explorer.reportingLines", "Reporting lines")}
			className="space-y-1 rounded-lg border bg-card p-2 text-card-foreground"
		>
			{props.tree.roots.map((id) => (
				<OutlineItem depth={0} employeeId={id} key={id} {...props} />
			))}
		</ul>
	);
}

function OutlineItem({
	employeeId,
	depth,
	...props
}: ReportingLinesProps & { employeeId: string; depth: number }) {
	const { t } = useTranslate();
	const person = props.peopleById.get(employeeId);
	if (!person) return null;
	const isOpen = props.openIds.has(employeeId);
	const children = props.tree.childrenOf(employeeId);
	const highlight = props.highlightOf(employeeId);
	const otherManagers = person.managerIds.length - 1;

	return (
		<li aria-label={personDisplayName(person)} data-highlight={highlight}>
			<div
				className={cn(
					"flex items-center gap-1 rounded-md transition-opacity",
					props.selectedId === employeeId && "bg-accent",
					highlight === "match" && "bg-primary/10",
					highlight === "dimmed" && "opacity-40",
				)}
				style={{ paddingLeft: `${depth * 1.25}rem` }}
			>
				<PersonButton
					className="flex-1"
					onSelect={props.onSelect}
					person={person}
				>
					{otherManagers > 0 ? (
						<span className="shrink-0 text-xs text-muted-foreground">
							{t(
								"organization.explorer.otherManagers",
								"{count, plural, one {+# manager} other {+# managers}}",
								{ count: otherManagers },
							)}
						</span>
					) : null}
				</PersonButton>
				<DirectReportsToggle
					isLoading={props.loadingIds.has(employeeId)}
					isOpen={isOpen}
					onToggle={props.onToggle}
					person={person}
				/>
			</div>
			{isOpen && children.length > 0 ? (
				<ul className="mt-1 space-y-1">
					{children.map((childId) => (
						<OutlineItem
							{...props}
							depth={depth + 1}
							employeeId={childId}
							key={childId}
						/>
					))}
				</ul>
			) : null}
		</li>
	);
}

/** People with no manager and no direct reports, kept off the top of the tree. */
export function NoReportingLineGroup({
	people,
	total,
	canLoad,
	isLoading,
	onLoad,
	onSelect,
	highlightOf,
}: {
	people: OrgExplorerPerson[];
	total: number;
	canLoad: boolean;
	isLoading: boolean;
	onLoad: () => void;
	onSelect: (employeeId: string) => void;
	highlightOf: (employeeId: string) => Highlight;
}) {
	const { t } = useTranslate();
	const headingId = useId();
	if (total === 0 && people.length === 0) return null;

	return (
		<section
			aria-labelledby={headingId}
			className="rounded-lg border bg-card p-4 text-card-foreground"
		>
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<h2 className="text-sm font-semibold" id={headingId}>
						{t("organization.explorer.noReportingLine", "No reporting line")}
					</h2>
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.explorer.noReportingLineDescription",
							"People with no manager and no direct reports.",
						)}
					</p>
				</div>
				{canLoad ? (
					<Button
						disabled={isLoading}
						onClick={onLoad}
						size="sm"
						type="button"
						variant="outline"
					>
						{t(
							"organization.explorer.showPeople",
							"{count, plural, one {Show # person} other {Show # people}}",
							{ count: total },
						)}
					</Button>
				) : null}
			</div>
			{people.length > 0 ? (
				<ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{people.map((person) => (
						<li
							className={cn(
								highlightOf(person.employeeId) === "dimmed" && "opacity-40",
							)}
							key={person.employeeId}
						>
							<PersonButton onSelect={onSelect} person={person} />
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
