"use client";

import { useState } from "react";
import type { CenterRequest } from "./org-explorer-reporting-lines";
import {
	buildReportingTree,
	defaultExpandedIds,
	type ReportingTree,
} from "./org-explorer-tree";
import type { OrgExplorerPerson } from "./org-explorer-types";
import {
	type OrgExplorerPeopleLoader,
	withIds,
	withoutIds,
} from "./use-org-explorer-people";

/**
 * Which reporting lines are open: the first levels and the ones the viewer
 * opened, plus the paths to the team filter's matches and to the selected
 * person, less the ones the viewer closed.
 */
export function useOrgExplorerLines({
	initialPeople,
	tree,
	pathIds,
	selectedId,
	loader,
	onSelect,
}: {
	initialPeople: OrgExplorerPerson[];
	tree: ReportingTree;
	/** The managers above the team filter's matches. */
	pathIds: ReadonlySet<string>;
	selectedId: string | null;
	loader: OrgExplorerPeopleLoader;
	onSelect: (employeeId: string) => void;
}) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
		defaultExpandedIds(buildReportingTree(initialPeople)),
	);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [centerRequest, setCenterRequest] = useState<CenterRequest | null>(
		() => (selectedId ? { employeeId: selectedId, nonce: 0 } : null),
	);

	const selectedPath = selectedId ? tree.pathTo(selectedId).slice(0, -1) : [];
	const openIds = new Set(
		[...expanded, ...pathIds, ...selectedPath].filter(
			(id) => !collapsed.has(id),
		),
	);

	/** Selects a person, opens the path to them and centres on them, loading what is missing. */
	async function reveal(employeeId: string) {
		onSelect(employeeId);
		await loader.loadPeople([employeeId], { withPaths: true });
		const path = buildReportingTree(loader.currentPeople())
			.pathTo(employeeId)
			.slice(0, -1);
		setCollapsed((current) => withoutIds(current, path));
		setExpanded((current) => withIds(current, path));
		setCenterRequest((current) => ({
			employeeId,
			nonce: (current?.nonce ?? 0) + 1,
		}));
	}

	function toggle(employeeId: string) {
		if (openIds.has(employeeId)) {
			setCollapsed((current) => withIds(current, [employeeId]));
			setExpanded((current) => withoutIds(current, [employeeId]));
			return;
		}
		setCollapsed((current) => withoutIds(current, [employeeId]));
		setExpanded((current) => withIds(current, [employeeId]));
		loader.loadLineReports(employeeId);
	}

	return { openIds, centerRequest, reveal, toggle };
}
