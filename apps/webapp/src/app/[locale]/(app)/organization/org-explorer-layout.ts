import { Graph, layout } from "@dagrejs/dagre";
import type { ReportingTree } from "./org-explorer-tree";

export const PERSON_CARD_WIDTH = 248;
export const PERSON_CARD_HEIGHT = 128;
const SIBLING_GAP = 32;
const LEVEL_GAP = 72;

export type ReportingLayout = {
	/** The top-left corner of each visible person's card. */
	positions: Map<string, { x: number; y: number }>;
	/** One line per visible person below the top, from their primary manager. */
	edges: Array<{ source: string; target: string }>;
};

/** A top-down tree layout of the visible people, with dagre. */
export function layoutReportingTree(
	tree: ReportingTree,
	visibleIds: readonly string[],
): ReportingLayout {
	const visible = new Set(visibleIds);
	const graph = new Graph();
	graph.setGraph({ rankdir: "TB", nodesep: SIBLING_GAP, ranksep: LEVEL_GAP });
	graph.setDefaultEdgeLabel(() => ({}));

	const edges: ReportingLayout["edges"] = [];
	for (const id of visibleIds) {
		graph.setNode(id, { width: PERSON_CARD_WIDTH, height: PERSON_CARD_HEIGHT });
		const parentId = tree.parentOf(id);
		if (parentId && visible.has(parentId))
			edges.push({ source: parentId, target: id });
	}
	for (const edge of edges) graph.setEdge(edge.source, edge.target);

	layout(graph);

	const positions = new Map<string, { x: number; y: number }>();
	for (const id of visibleIds) {
		const node = graph.node(id);
		positions.set(id, {
			x: node.x - PERSON_CARD_WIDTH / 2,
			y: node.y - PERSON_CARD_HEIGHT / 2,
		});
	}

	return { positions, edges };
}
