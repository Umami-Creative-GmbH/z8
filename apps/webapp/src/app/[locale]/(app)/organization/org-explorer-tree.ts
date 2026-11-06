import type { OrgExplorerPerson } from "./org-explorer-types";

/** The reporting lines among the loaded people: one line per person, from their primary manager. */
export type ReportingTree = {
	/**
	 * The top level: people with no manager who have direct reports. A person whose
	 * primary manager is not loaded, and the first person of a loop, also start here.
	 */
	roots: string[];
	/** People with no manager and no direct reports. */
	noReportingLine: string[];
	childrenOf(employeeId: string): string[];
	parentOf(employeeId: string): string | null;
	/** The people from the top down to `employeeId`, or none when it is not in the tree. */
	pathTo(employeeId: string): string[];
};

export function buildReportingTree(people: OrgExplorerPerson[]): ReportingTree {
	const sorted = people.toSorted(compareByName);
	const order = new Map(
		sorted.map((entry, index) => [entry.employeeId, index]),
	);
	const parents = new Map<string, string>();
	const noReportingLine: string[] = [];

	for (const entry of sorted) {
		const managerId = entry.managerIds[0];
		if (managerId && order.has(managerId) && managerId !== entry.employeeId) {
			parents.set(entry.employeeId, managerId);
		} else if (entry.managerIds.length === 0 && entry.reportIds.length === 0) {
			noReportingLine.push(entry.employeeId);
		}
	}

	breakLoops(sorted, parents, order);

	const children = new Map<string, string[]>();
	const roots: string[] = [];
	const unplaced = new Set(noReportingLine);
	for (const entry of sorted) {
		const parentId = parents.get(entry.employeeId);
		if (parentId) {
			children.set(parentId, [
				...(children.get(parentId) ?? []),
				entry.employeeId,
			]);
		} else if (!unplaced.has(entry.employeeId)) {
			roots.push(entry.employeeId);
		}
	}

	return {
		roots,
		noReportingLine,
		childrenOf: (employeeId) => children.get(employeeId) ?? [],
		parentOf: (employeeId) => parents.get(employeeId) ?? null,
		pathTo(employeeId) {
			if (!order.has(employeeId)) return [];
			const path = [employeeId];
			for (
				let parentId = parents.get(employeeId);
				parentId;
				parentId = parents.get(parentId)
			) {
				path.unshift(parentId);
			}
			return path;
		},
	};
}

/** How many levels below the top open by default. */
export const DEFAULT_OPEN_LEVELS = 2;

/** The people whose subtree is open by default: the top level and the level below it. */
export function defaultExpandedIds(tree: ReportingTree): Set<string> {
	const expanded = new Set<string>();
	let level = tree.roots;
	for (let depth = 0; depth < DEFAULT_OPEN_LEVELS; depth += 1) {
		for (const id of level) expanded.add(id);
		level = level.flatMap((id) => tree.childrenOf(id));
	}
	return expanded;
}

/** The people shown in the tree, top down, when only the `expanded` subtrees are open. */
export function visibleTreeIds(
	tree: ReportingTree,
	expanded: ReadonlySet<string>,
): string[] {
	const visible: string[] = [];
	const visit = (id: string) => {
		visible.push(id);
		if (expanded.has(id))
			for (const childId of tree.childrenOf(id)) visit(childId);
	};
	for (const rootId of tree.roots) visit(rootId);
	return visible;
}

/**
 * Reporting lines can loop in the data. Each loop is cut above its first person
 * by name, who then starts at the top, so everyone in it stays visible.
 */
function breakLoops(
	sorted: OrgExplorerPerson[],
	parents: Map<string, string>,
	order: Map<string, number>,
) {
	const settled = new Set<string>();

	for (const entry of sorted) {
		const chain: string[] = [];
		const inChain = new Set<string>();
		let current: string | undefined = entry.employeeId;

		while (current && !settled.has(current) && !inChain.has(current)) {
			chain.push(current);
			inChain.add(current);
			current = parents.get(current);
		}

		if (current && inChain.has(current)) {
			const loop = chain.slice(chain.indexOf(current));
			const first = loop.toSorted(
				(a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
			)[0];
			if (first) parents.delete(first);
		}

		for (const id of chain) settled.add(id);
	}
}

/** Orders people by name, then id, so lists stay stable. */
export function compareByName(
	first: OrgExplorerPerson,
	second: OrgExplorerPerson,
) {
	return (
		first.name.localeCompare(second.name) ||
		first.employeeId.localeCompare(second.employeeId)
	);
}
