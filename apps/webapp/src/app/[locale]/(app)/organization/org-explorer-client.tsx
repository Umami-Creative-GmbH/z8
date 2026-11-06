"use client";

import { useTranslate } from "@tolgee/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import {
	getOrgExplorerData,
	getOrgExplorerGroup,
	getOrgExplorerPeople,
	getOrgExplorerTeamMembers,
} from "./actions";
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
import {
	ORG_EXPLORER_BATCH_LIMIT,
	type OrgExplorerData,
	type OrgExplorerGroup,
	type OrgExplorerPerson,
} from "./org-explorer-types";
import { useOrgExplorerUrlState } from "./use-org-explorer-url-state";

type OrgExplorerClientProps = {
	initialData: OrgExplorerData;
	/** Whether the viewer is an organization admin, who gets links to the settings screens. */
	canManage: boolean;
};

type Summary = Omit<OrgExplorerData, "people">;

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
	const [summary, setSummary] = useState<Summary>(() => summaryOf(initialData));
	const [peopleById, setPeopleById] = useState(() =>
		toPeopleMap(initialData.people),
	);
	// The latest people between renders, so loads that finish one after another all merge.
	const peopleRef = useRef(peopleById);
	const pendingLoads = useRef(new Map<string, Promise<void>>());
	const requestedTeamIds = useRef(new Set<string>());
	const [unknownIds, setUnknownIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [loadingTeamIds, setLoadingTeamIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [loadedGroups, setLoadedGroups] = useState<
		ReadonlySet<OrgExplorerGroup>
	>(() => new Set());
	const [loadingGroups, setLoadingGroups] = useState<
		ReadonlySet<OrgExplorerGroup>
	>(() => new Set());
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

	function showFailure(message: string | undefined) {
		toast.error(
			message ||
				t("organization.explorer.loadFailed", "Could not load people."),
		);
	}

	function mergePeople(incoming: OrgExplorerPerson[]) {
		if (incoming.length === 0) return;
		const next = new Map(peopleRef.current);
		for (const entry of incoming) next.set(entry.employeeId, entry);
		peopleRef.current = next;
		setPeopleById(next);
	}

	/**
	 * Loads the people not loaded yet, and waits for those already on their way.
	 * A complete organization has everyone already.
	 */
	async function loadPeople(
		employeeIds: string[],
		options?: { withPaths: true },
	) {
		if (summary.complete) return;
		const unique = [...new Set(employeeIds)];
		const waiting = unique.flatMap((id) => pendingLoads.current.get(id) ?? []);
		const missing = unique.filter(
			(id) =>
				!peopleRef.current.has(id) &&
				!pendingLoads.current.has(id) &&
				!unknownIds.has(id),
		);
		if (missing.length > 0) {
			const load = fetchPeople(missing, options);
			for (const id of missing) pendingLoads.current.set(id, load);
			waiting.push(load);
		}
		await Promise.all(waiting);
	}

	async function fetchPeople(missing: string[], options?: { withPaths: true }) {
		try {
			for (
				let start = 0;
				start < missing.length;
				start += ORG_EXPLORER_BATCH_LIMIT
			) {
				const chunk = missing.slice(start, start + ORG_EXPLORER_BATCH_LIMIT);
				const result = options
					? await getOrgExplorerPeople(chunk, options)
					: await getOrgExplorerPeople(chunk);
				if (!result.success) {
					showFailure(result.error);
					return;
				}
				mergePeople(result.data);
				// Nobody comes back for an id that is not on the current roster.
				const notFound = chunk.filter((id) => !peopleRef.current.has(id));
				if (notFound.length > 0)
					setUnknownIds((current) => withIds(current, notFound));
			}
		} finally {
			for (const id of missing) pendingLoads.current.delete(id);
		}
	}

	async function loadTeamMembers(teamIds: string[]) {
		const pending = teamIds.filter((id) => !requestedTeamIds.current.has(id));
		if (summary.complete || pending.length === 0) return;
		for (const id of pending) requestedTeamIds.current.add(id);
		setLoadingTeamIds((current) => withIds(current, pending));
		const result = await getOrgExplorerTeamMembers(pending);
		setLoadingTeamIds((current) => withoutIds(current, pending));
		if (!result.success) {
			for (const id of pending) requestedTeamIds.current.delete(id);
			showFailure(result.error);
			return;
		}
		mergePeople(result.data);
	}

	async function loadGroup(group: OrgExplorerGroup) {
		setLoadingGroups((current) => withIds(current, [group]));
		const result = await getOrgExplorerGroup(group);
		setLoadingGroups((current) => withoutIds(current, [group]));
		if (!result.success) {
			showFailure(result.error);
			return;
		}
		mergePeople(result.data);
		setLoadedGroups((current) => withIds(current, [group]));
	}

	function select(employeeId: string) {
		setUrl({ employeeId });
	}

	/** Selects a person, opens the path to them and centres on them, loading what is missing. */
	async function reveal(employeeId: string) {
		setUrl({ employeeId });
		await loadPeople([employeeId], { withPaths: true });
		const path = buildReportingTree([...peopleRef.current.values()])
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

		const missing =
			peopleRef.current
				.get(employeeId)
				?.lineReportIds.filter((id) => !peopleRef.current.has(id)) ?? [];
		if (summary.complete || missing.length === 0) return;
		setLoadingIds((current) => withIds(current, [employeeId]));
		void loadPeople(missing).finally(() => {
			setLoadingIds((current) => withoutIds(current, [employeeId]));
		});
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
		if (key) void loadTeamMembers(key.split(","));
	});
	useEffect(() => loadFilteredTeams(filterKey), [filterKey]);

	useViewRefresh(async () => {
		const result = await getOrgExplorerData();
		if (!result.success) throw new Error(result.error);
		const fresh = toPeopleMap(result.data.people);
		const stillShown = [...peopleRef.current.keys()].filter(
			(id) => !fresh.has(id),
		);
		if (!result.data.complete) {
			for (
				let start = 0;
				start < stillShown.length;
				start += ORG_EXPLORER_BATCH_LIMIT
			) {
				const reloaded = await getOrgExplorerPeople(
					stillShown.slice(start, start + ORG_EXPLORER_BATCH_LIMIT),
				);
				if (!reloaded.success) throw new Error(reloaded.error);
				for (const entry of reloaded.data) fresh.set(entry.employeeId, entry);
			}
		}
		requestedTeamIds.current.clear();
		setUnknownIds(new Set());
		peopleRef.current = fresh;
		setPeopleById(fresh);
		setSummary(summaryOf(result.data));
	});

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
		loadingIds,
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
					complete={summary.complete}
					grouped={groupTeams(summary.teams, people, url.teamIds)}
					isNoTeamLoaded={loadedGroups.has("noTeam")}
					isNoTeamLoading={loadingGroups.has("noTeam")}
					loadingTeamIds={loadingTeamIds}
					noTeamCount={summary.noTeamCount}
					onLoadNoTeam={() => void loadGroup("noTeam")}
					onLoadTeam={(teamId) => void loadTeamMembers([teamId])}
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
							!summary.complete &&
							!loadedGroups.has("noReportingLine") &&
							noReportingLine.length < summary.noReportingLineCount
						}
						highlightOf={highlightOf}
						isLoading={loadingGroups.has("noReportingLine")}
						onLoad={() => void loadGroup("noReportingLine")}
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

function summaryOf({ people: _people, ...summary }: OrgExplorerData): Summary {
	return summary;
}

function toPeopleMap(people: OrgExplorerPerson[]) {
	return new Map(people.map((entry) => [entry.employeeId, entry]));
}

function withIds<T>(
	current: ReadonlySet<T>,
	ids: readonly T[],
): ReadonlySet<T> {
	if (ids.every((id) => current.has(id))) return current;
	return new Set([...current, ...ids]);
}

function withoutIds<T>(
	current: ReadonlySet<T>,
	ids: readonly T[],
): ReadonlySet<T> {
	if (!ids.some((id) => current.has(id))) return current;
	const next = new Set(current);
	for (const id of ids) next.delete(id);
	return next;
}
