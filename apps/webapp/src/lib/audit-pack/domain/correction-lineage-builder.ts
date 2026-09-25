import type { CorrectionClosureResult, LineageLinkNode } from "./types";

/** Append adjacency follows only the resolved predecessor, never an unresolved stored ID. */
function getLinkedIds(node: LineageLinkNode): string[] {
	const linkedIds = [node.appendPredecessorId, node.replacesEntryId, node.supersededById];
	return linkedIds.filter((id): id is string => id !== null && id.length > 0);
}

export function buildCorrectionClosure(
	seedNodes: readonly LineageLinkNode[],
	lookupById: Readonly<Record<string, LineageLinkNode>>,
): CorrectionClosureResult {
	const seedIds = Array.from(new Set(seedNodes.map((node) => node.id))).toSorted();
	const inRangeSeedIds = new Set(seedIds);

	const nodesById = new Map<string, LineageLinkNode>(Object.entries(lookupById));
	for (const seedNode of seedNodes) {
		nodesById.set(seedNode.id, seedNode);
	}

	const visited = new Set(seedIds);
	const queue = [...seedIds];

	while (queue.length > 0) {
		const currentId = queue.shift();
		if (!currentId) {
			continue;
		}

		const currentNode = nodesById.get(currentId);
		if (!currentNode) {
			continue;
		}

		for (const linkedId of getLinkedIds(currentNode)) {
			if (visited.has(linkedId)) {
				continue;
			}

			visited.add(linkedId);
			queue.push(linkedId);
		}
	}

	const nodeIds = Array.from(visited).toSorted();
	return {
		nodeIds,
		expandedOutsideRange: nodeIds.filter((id) => !inRangeSeedIds.has(id)),
	};
}
