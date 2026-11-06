"use client";

import { useTranslate } from "@tolgee/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useEffectEvent } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { PersonPanel } from "./org-explorer-person-panel";
import {
	type Highlight,
	NoReportingLineGroup,
	ReportingLinesCanvas,
	ReportingLinesOutline,
	type ReportingLinesProps,
} from "./org-explorer-reporting-lines";
import { groupTeams } from "./org-explorer-teams";
import { TeamsView } from "./org-explorer-teams-view";
import { EmployeeSearch, TeamFilter, ViewSwitch } from "./org-explorer-toolbar";
import { buildReportingTree, type ReportingTree } from "./org-explorer-tree";
import type { OrgExplorerData, OrgExplorerPerson } from "./org-explorer-types";
import type { OrgExplorerUrlState } from "./org-explorer-url";
import { useOrgExplorerLines } from "./use-org-explorer-lines";
import {
	type OrgExplorerPeopleLoader,
	useOrgExplorerPeople,
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
	const { summary, peopleById } = loader;

	const people = [...peopleById.values()];
	const tree = buildReportingTree(people);
	const teamNamesById = new Map(
		summary.teams.map((entry) => [entry.teamId, entry.name]),
	);
	const { pathIds, highlightOf } = teamFilterHighlights(
		people,
		tree,
		url.teamIds,
	);

	function select(employeeId: string) {
		setUrl({ employeeId });
	}

	const { openIds, centerRequest, reveal, toggle } = useOrgExplorerLines({
		initialPeople: initialData.people,
		tree,
		pathIds,
		selectedId: url.employeeId,
		loader,
		onSelect: select,
	});
	useOrgExplorerUrlLoads(url, loader);

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
				<ReportingLinesView
					isMobile={isMobile}
					lines={lineProps}
					loader={loader}
				/>
			)}

			<PersonPanel
				canManage={canManage}
				employeeId={shownEmployeeIdOf(url.employeeId, loader)}
				onClose={() => setUrl({ employeeId: null })}
				onSelect={(employeeId) => void reveal(employeeId)}
				peopleById={peopleById}
				side={isMobile ? "bottom" : "right"}
				teamNamesById={teamNamesById}
			/>
		</section>
	);
}

/** The team filter highlights members and keeps their paths to the top open. */
function teamFilterHighlights(
	people: OrgExplorerPerson[],
	tree: ReportingTree,
	teamIds: string[],
) {
	const filter = new Set(teamIds);
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
	const highlightOf = (employeeId: string): Highlight => {
		if (filter.size === 0) return "none";
		if (matches.has(employeeId)) return "match";
		return pathIds.has(employeeId) ? "path" : "dimmed";
	};
	return { pathIds, highlightOf };
}

/**
 * A large organization loads the selected person, their managers and reports,
 * and the filtered teams' members when the URL names them, also after the back button.
 */
function useOrgExplorerUrlLoads(
	url: OrgExplorerUrlState,
	loader: OrgExplorerPeopleLoader,
) {
	const selected = url.employeeId
		? loader.peopleById.get(url.employeeId)
		: undefined;
	const loadSelected = useEffectEvent(
		(employeeId: string | null, person: OrgExplorerPerson | undefined) => {
			if (!employeeId) return;
			void loader.loadPeople(
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
}

/** An id that is not on the current roster opens nothing. */
function shownEmployeeIdOf(
	employeeId: string | null,
	{ peopleById, unknownIds, summary }: OrgExplorerPeopleLoader,
) {
	return employeeId &&
		!unknownIds.has(employeeId) &&
		(peopleById.has(employeeId) || !summary.complete)
		? employeeId
		: null;
}

/** The reporting lines, as an outline on a phone, and the people without one. */
function ReportingLinesView({
	lines,
	isMobile,
	loader,
}: {
	lines: ReportingLinesProps;
	isMobile: boolean;
	loader: OrgExplorerPeopleLoader;
}) {
	const { t } = useTranslate();
	const { tree, peopleById } = lines;
	const { summary } = loader;
	const noReportingLine = tree.noReportingLine.flatMap(
		(id) => peopleById.get(id) ?? [],
	);

	return (
		<>
			{tree.roots.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					{t(
						"organization.explorer.noReportingLines",
						"Nobody has a reporting line yet.",
					)}
				</p>
			) : isMobile ? (
				<ReportingLinesOutline {...lines} />
			) : (
				<ReportingLinesCanvas {...lines} />
			)}
			<NoReportingLineGroup
				canLoad={
					loader.canLoadGroup("noReportingLine") &&
					noReportingLine.length < summary.noReportingLineCount
				}
				highlightOf={lines.highlightOf}
				isLoading={loader.loadingGroups.has("noReportingLine")}
				onLoad={() => void loader.loadGroupPage("noReportingLine")}
				onSelect={lines.onSelect}
				people={noReportingLine}
				total={summary.noReportingLineCount}
			/>
		</>
	);
}
