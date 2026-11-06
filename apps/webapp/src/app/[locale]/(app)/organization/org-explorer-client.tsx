"use client";

import { useTranslate } from "@tolgee/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useEffectEvent, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PersonPanel } from "./org-explorer-person-panel";
import {
	type CenterRequest,
	type Highlight,
	NoReportingLineGroup,
	ReportingLinesCanvas,
	ReportingLinesOutline,
	type ReportingLinesProps,
} from "./org-explorer-reporting-lines";
import { groupTeams } from "./org-explorer-teams";
import { TeamsView } from "./org-explorer-teams-view";
import { EmployeeSearch, TeamFilter, ViewSwitch } from "./org-explorer-toolbar";
import { buildReportingTree, defaultExpandedIds } from "./org-explorer-tree";
import type { OrgExplorerData, OrgExplorerPerson } from "./org-explorer-types";
import {
	useOrgExplorerPeople,
	withIds,
	withoutIds,
} from "./use-org-explorer-people";
import { useOrgExplorerUrlState } from "./use-org-explorer-url-state";

type OrgExplorerClientProps = {
	initialData: OrgExplorerData;
	/** Whether the viewer is an organization admin, who gets links to the settings screens. */
	canManage: boolean;
};

export function OrgExplorerClient(props: OrgExplorerClientProps) {
	return (
		<ReactFlowProvider>
			<OrgExplorer {...props} />
		</ReactFlowProvider>
	);
}

function OrgExplorer({ initialData, canManage }: OrgExplorerClientProps) {
	const { t } = useTranslate();
	const isMobile = useIsMobile();
	const [url, setUrl] = useOrgExplorerUrlState();
	const loader = useOrgExplorerPeople(initialData);
	const { summary, peopleById, unknownIds, loadPeople } = loader;
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
		defaultExpandedIds(buildReportingTree(initialData.people)),
	);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [centerRequest, setCenterRequest] = useState<CenterRequest | null>(
		() => (url.employeeId ? { employeeId: url.employeeId, nonce: 0 } : null),
	);

	const people = [...peopleById.values()];
	const tree = buildReportingTree(people);
	const teamNamesById = new Map(
		summary.teams.map((entry) => [entry.teamId, entry.name]),
	);

	// The team filter highlights members and keeps their paths to the top open.
	const filter = new Set(url.teamIds);
	const matches = new Set(
		filter.size === 0
			? []
			: people
					.filter((entry) => entry.teamIds.some((teamId) => filter.has(teamId)))
					.map((entry) => entry.employeeId),
	);
	const pathIds = new Set(
		[...matches].flatMap((id) => tree.pathTo(id).slice(0, -1)),
	);
	const selectedPath = url.employeeId
		? tree.pathTo(url.employeeId).slice(0, -1)
		: [];
	const openIds = new Set(
		[...expanded, ...pathIds, ...selectedPath].filter(
			(id) => !collapsed.has(id),
		),
	);
	const highlightOf = (employeeId: string): Highlight => {
		if (filter.size === 0) return "none";
		if (matches.has(employeeId)) return "match";
		return pathIds.has(employeeId) ? "path" : "dimmed";
	};

	function select(employeeId: string) {
		setUrl({ employeeId });
	}

	/** Selects a person, opens the path to them and centres on them, loading what is missing. */
	async function reveal(employeeId: string) {
		setUrl({ employeeId });
		await loadPeople([employeeId], { withPaths: true });
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

	// A large organization loads the selected person, their managers and reports,
	// and the filtered teams' members when the URL names them, also after the back button.
	const selected = url.employeeId ? peopleById.get(url.employeeId) : undefined;
	const loadSelected = useEffectEvent(
		(employeeId: string | null, person: OrgExplorerPerson | undefined) => {
			if (!employeeId) return;
			void loadPeople(
				person ? [...person.managerIds, ...person.reportIds] : [employeeId],
				{
					withPaths: true,
				},
			);
		},
	);
	useEffect(
		() => loadSelected(url.employeeId, selected),
		[url.employeeId, selected],
	);

	const filterKey = url.teamIds.join(",");
	const loadFilteredTeams = useEffectEvent((key: string) => {
		if (key) loader.loadTeamsStarted(key.split(","));
	});
	useEffect(() => loadFilteredTeams(filterKey), [filterKey]);

	if (summary.employeeCount === 0 && peopleById.size === 0) {
		return (
			<section className="flex min-h-[420px] items-center justify-center rounded-lg border bg-card text-card-foreground">
				<p className="text-sm text-muted-foreground">
					{t("organization.explorer.empty", "No current employees found")}
				</p>
			</section>
		);
	}

	const lineProps: ReportingLinesProps = {
		tree,
		peopleById,
		teamNamesById,
		openIds,
		highlightOf,
		selectedId: url.employeeId,
		loadingIds: loader.loadingIds,
		centerRequest,
		onSelect: select,
		onToggle: toggle,
	};
	const noReportingLine = tree.noReportingLine.flatMap(
		(id) => peopleById.get(id) ?? [],
	);
	// An id that is not on the current roster opens nothing.
	const shownEmployeeId =
		url.employeeId &&
		!unknownIds.has(url.employeeId) &&
		(peopleById.has(url.employeeId) || !summary.complete)
			? url.employeeId
			: null;

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm md:flex-row md:items-center md:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					<ViewSwitch onChange={(view) => setUrl({ view })} view={url.view} />
					<TeamFilter
						onChange={(teamIds) => setUrl({ teamIds })}
						selectedIds={url.teamIds}
						teams={summary.teams}
					/>
				</div>
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.explorer.employeeCount",
							"{count, plural, one {# employee} other {# employees}}",
							{ count: summary.employeeCount },
						)}
					</p>
					<EmployeeSearch onSelect={(employeeId) => void reveal(employeeId)} />
				</div>
			</div>

			{summary.complete ? null : (
				<p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					{t(
						"organization.explorer.partial",
						"This is a large organization, so people load as you open reporting lines and teams or search.",
					)}
				</p>
			)}

			{url.view === "teams" ? (
				<TeamsView
					canLoadNoTeam={loader.canLoadGroup("noTeam")}
					canLoadTeam={loader.canLoadTeam}
					complete={summary.complete}
					grouped={groupTeams(summary.teams, people, url.teamIds)}
					isNoTeamLoading={loader.loadingGroups.has("noTeam")}
					loadingTeamIds={loader.loadingTeamIds}
					noTeamCount={summary.noTeamCount}
					onLoadNoTeam={() => void loader.loadGroupPage("noTeam")}
					onLoadTeam={(teamId) => void loader.loadTeamPage(teamId)}
					onSelect={select}
					showNoTeam={url.teamIds.length === 0}
				/>
			) : (
				<>
					{tree.roots.length === 0 ? (
						<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
							{t(
								"organization.explorer.noReportingLines",
								"Nobody has a reporting line yet.",
							)}
						</p>
					) : isMobile ? (
						<ReportingLinesOutline {...lineProps} />
					) : (
						<ReportingLinesCanvas {...lineProps} />
					)}
					<NoReportingLineGroup
						canLoad={
							loader.canLoadGroup("noReportingLine") &&
							noReportingLine.length < summary.noReportingLineCount
						}
						highlightOf={highlightOf}
						isLoading={loader.loadingGroups.has("noReportingLine")}
						onLoad={() => void loader.loadGroupPage("noReportingLine")}
						onSelect={select}
						people={noReportingLine}
						total={summary.noReportingLineCount}
					/>
				</>
			)}

			<PersonPanel
				canManage={canManage}
				employeeId={shownEmployeeId}
				onClose={() => setUrl({ employeeId: null })}
				onSelect={(employeeId) => void reveal(employeeId)}
				peopleById={peopleById}
				side={isMobile ? "bottom" : "right"}
				teamNamesById={teamNamesById}
			/>
		</section>
	);
}
