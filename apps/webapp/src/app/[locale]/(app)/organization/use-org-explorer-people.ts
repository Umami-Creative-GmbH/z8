"use client";

import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import {
	getOrgExplorerData,
	getOrgExplorerGroup,
	getOrgExplorerPeople,
	getOrgExplorerTeamMembers,
} from "./actions";
import {
	ORG_EXPLORER_BATCH_LIMIT,
	type OrgExplorerData,
	type OrgExplorerGroup,
	type OrgExplorerPerson,
} from "./org-explorer-types";

export type OrgExplorerSummary = Omit<OrgExplorerData, "people">;

/**
 * Where the next page of a team's members or of a group starts: absent before
 * the first page, null once everything is loaded.
 */
type NextOffsets<K> = ReadonlyMap<K, number | null>;

/**
 * The people the Org Explorer has loaded and what is loading. A complete
 * organization has everyone from the start. A large one loads people by id,
 * the reports below a person, and teams' members and the unplaced groups a
 * page at a time.
 */
export function useOrgExplorerPeople(initialData: OrgExplorerData) {
	const { t } = useTranslate();
	const [summary, setSummary] = useState<OrgExplorerSummary>(() =>
		summaryOf(initialData),
	);
	const [peopleById, setPeopleById] = useState(() =>
		toPeopleMap(initialData.people),
	);
	// The latest people between renders, so loads that finish one after another all merge.
	const peopleRef = useRef(peopleById);
	const pendingLoads = useRef(new Map<string, Promise<void>>());
	// Pages on their way, so a second click does not ask for the same page again.
	const pendingPages = useRef(new Set<string>());
	const [unknownIds, setUnknownIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [loadingTeamIds, setLoadingTeamIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [loadingGroups, setLoadingGroups] = useState<
		ReadonlySet<OrgExplorerGroup>
	>(() => new Set());
	const [teamOffsets, setTeamOffsets] = useState<NextOffsets<string>>(
		() => new Map(),
	);
	const [groupOffsets, setGroupOffsets] = useState<
		NextOffsets<OrgExplorerGroup>
	>(() => new Map());

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

	// `.finally` rather than `try … finally`, which React Compiler cannot lower.
	function fetchPeople(missing: string[], options?: { withPaths: true }) {
		return fetchPeopleBatches(missing, options).finally(() => {
			for (const id of missing) pendingLoads.current.delete(id);
		});
	}

	async function fetchPeopleBatches(
		missing: string[],
		options?: { withPaths: true },
	) {
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
	}

	/** Loads the line reports below a person that are not loaded yet. */
	function loadLineReports(employeeId: string) {
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

	/** Loads the next page of a team's members, unless all are loaded. */
	async function loadTeamPage(teamId: string) {
		const offset = teamOffsets.get(teamId);
		const key = `team:${teamId}`;
		if (summary.complete || offset === null || pendingPages.current.has(key))
			return;
		pendingPages.current.add(key);
		setLoadingTeamIds((current) => withIds(current, [teamId]));
		const result = await getOrgExplorerTeamMembers(teamId, offset ?? 0);
		pendingPages.current.delete(key);
		setLoadingTeamIds((current) => withoutIds(current, [teamId]));
		if (!result.success) {
			showFailure(result.error);
			return;
		}
		mergePeople(result.data.people);
		setTeamOffsets((current) =>
			new Map(current).set(teamId, result.data.nextOffset),
		);
	}

	/** Loads the first page of each team that has none yet. */
	function loadTeamsStarted(teamIds: readonly string[]) {
		for (const teamId of teamIds) {
			if (!teamOffsets.has(teamId)) void loadTeamPage(teamId);
		}
	}

	/** Loads the next page of a group, unless all are loaded. */
	async function loadGroupPage(group: OrgExplorerGroup) {
		const offset = groupOffsets.get(group);
		const key = `group:${group}`;
		if (summary.complete || offset === null || pendingPages.current.has(key))
			return;
		pendingPages.current.add(key);
		setLoadingGroups((current) => withIds(current, [group]));
		const result = await getOrgExplorerGroup(group, offset ?? 0);
		pendingPages.current.delete(key);
		setLoadingGroups((current) => withoutIds(current, [group]));
		if (!result.success) {
			showFailure(result.error);
			return;
		}
		mergePeople(result.data.people);
		setGroupOffsets((current) =>
			new Map(current).set(group, result.data.nextOffset),
		);
	}

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
		setTeamOffsets(new Map());
		setGroupOffsets(new Map());
		setUnknownIds(new Set());
		peopleRef.current = fresh;
		setPeopleById(fresh);
		setSummary(summaryOf(result.data));
	});

	return {
		summary,
		peopleById,
		/** The latest people, also before the next render. */
		currentPeople: () => [...peopleRef.current.values()],
		unknownIds,
		/** People whose line reports are loading. */
		loadingIds,
		loadingTeamIds,
		loadingGroups,
		/** Whether a team may have members left to load. */
		canLoadTeam: (teamId: string) =>
			!summary.complete && teamOffsets.get(teamId) !== null,
		/** Whether a group may have people left to load. */
		canLoadGroup: (group: OrgExplorerGroup) =>
			!summary.complete && groupOffsets.get(group) !== null,
		loadPeople,
		loadLineReports,
		loadTeamPage,
		loadTeamsStarted,
		loadGroupPage,
	};
}

function summaryOf({
	people: _people,
	...summary
}: OrgExplorerData): OrgExplorerSummary {
	return summary;
}

function toPeopleMap(people: OrgExplorerPerson[]) {
	return new Map(people.map((entry) => [entry.employeeId, entry]));
}

export function withIds<T>(
	current: ReadonlySet<T>,
	ids: readonly T[],
): ReadonlySet<T> {
	if (ids.every((id) => current.has(id))) return current;
	return new Set([...current, ...ids]);
}

export function withoutIds<T>(
	current: ReadonlySet<T>,
	ids: readonly T[],
): ReadonlySet<T> {
	if (!ids.some((id) => current.has(id))) return current;
	const next = new Set(current);
	for (const id of ids) next.delete(id);
	return next;
}
