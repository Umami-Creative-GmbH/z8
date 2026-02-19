import type { CorrectionClosureResult, CorrectionLinkNode } from "./types";

function getLinkedIds(node: CorrectionLinkNode): string[] {
	const linkedIds = [node.previousEntryId, node.replacesEntryId, node.supersededById];
	return linkedIds.filter((id): id is string => id !== null && id.length > 0);
}

export function buildCorrectionClosure(
	seedNodes: readonly CorrectionLinkNode[],
	lookupById: Readonly<Record<string, CorrectionLinkNode>>,
): CorrectionClosureResult {
	const seedIds = [...new Set(seedNodes.map((node) => node.id))].sort();
	const inRangeSeedIds = new Set(seedIds);

	const nodesById = new Map<string, CorrectionLinkNode>(Object.entries(lookupById));
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

	const nodeIds = [...visited].sort();
	return {
		nodeIds,
		expandedOutsideRange: nodeIds.filter((id) => !inRangeSeedIds.has(id)),
	};
}
