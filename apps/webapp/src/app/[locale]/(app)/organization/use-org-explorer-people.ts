"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { mapConcurrently } from "@/lib/async/map-concurrently";
import type { ServerActionResult } from "@/lib/effect/result";
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

export type OrgExplorerPeopleLoader = ReturnType<typeof useOrgExplorerPeople>;

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
	const generation = useRef(0);
	const [failedLoads, setFailedLoads] = useState<
		ReadonlyMap<string, () => Promise<void>>
	>(() => new Map());
	const [isRetrying, setIsRetrying] = useState(false);
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
	useEffect(
		() => () => {
			generation.current += 1;
			// Effect replay / cached-route return must not wait on a discarded generation.
			pendingLoads.current.clear();
			pendingPages.current.clear();
		},
		[],
	);
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

	/** Only the current mounted roster may accept a response, including retries. */
	async function readPeople<T>(
		key: string,
		read: () => Promise<ServerActionResult<T>>,
		accept: (data: T) => void,
	) {
		const version = generation.current;
		await settleRead(key, async () => {
			const result = await read();
			if (version !== generation.current) return;
			if (!result.success) throw new Error("Roster read failed");
			accept(result.data);
		});
	}

	const settleRead = async (key: string, read: () => Promise<void>) => {
		const version = generation.current;
		try {
			await read();
			if (version !== generation.current) return;
			setFailedLoads((current) => {
				const next = new Map(current);
				next.delete(key);
				return next;
			});
		} catch {
			if (version !== generation.current) return;
			setFailedLoads((current) => new Map(current).set(key, read));
			showFailure(undefined);
		}
	};

	async function retryFailed() {
		if (isRetrying) return;
		setIsRetrying(true);
		await Promise.all(
			[...failedLoads].map(([key, read]) => settleRead(key, read)),
		).finally(() => setIsRetrying(false));
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
		const load = fetchPeopleBatches(missing, options).finally(() => {
			for (const id of missing) {
				if (pendingLoads.current.get(id) === load)
					pendingLoads.current.delete(id);
			}
		});
		return load;
	}

	async function fetchPeopleBatches(
		missing: string[],
		options?: { withPaths: true },
	) {
		const version = generation.current;
		const chunks: string[][] = [];
		for (
			let start = 0;
			start < missing.length;
			start += ORG_EXPLORER_BATCH_LIMIT
		) {
			chunks.push(missing.slice(start, start + ORG_EXPLORER_BATCH_LIMIT));
		}
		// Keep the existing one-request bound; cancelled scopes start no further batches.
		await mapConcurrently(chunks, 1, async (chunk) => {
			if (version !== generation.current) return;
			await readPeople(
				`people:${chunk.join(",")}`,
				() =>
					options
						? getOrgExplorerPeople(chunk, options)
						: getOrgExplorerPeople(chunk),
				(incoming) => {
					mergePeople(incoming);
					// Nobody comes back for an id that is not on the current roster.
					const notFound = chunk.filter((id) => !peopleRef.current.has(id));
					if (notFound.length > 0)
						setUnknownIds((current) => withIds(current, notFound));
				},
			);
		});
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
		await readPeople(
			key,
			() => getOrgExplorerTeamMembers(teamId, offset ?? 0),
			(data) => {
				mergePeople(data.people);
				setTeamOffsets((current) =>
					new Map(current).set(teamId, data.nextOffset),
				);
			},
		);
		pendingPages.current.delete(key);
		setLoadingTeamIds((current) => withoutIds(current, [teamId]));
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
		await readPeople(
			key,
			() => getOrgExplorerGroup(group, offset ?? 0),
			(data) => {
				mergePeople(data.people);
				setGroupOffsets((current) =>
					new Map(current).set(group, data.nextOffset),
				);
			},
		);
		pendingPages.current.delete(key);
		setLoadingGroups((current) => withoutIds(current, [group]));
	}

	useViewRefresh(async () => {
		const version = ++generation.current;
		setFailedLoads(new Map());
		const result = await getOrgExplorerData();
		if (version !== generation.current) return;
		if (!result.success) throw new Error(result.error);
		const fresh = toPeopleMap(result.data.people);
		const stillShown = [...peopleRef.current.keys()].filter(
			(id) => !fresh.has(id),
		);
		if (!result.data.complete) {
			// The batches are independent reads: load them side by side.
			const chunks: string[][] = [];
			for (
				let start = 0;
				start < stillShown.length;
				start += ORG_EXPLORER_BATCH_LIMIT
			) {
				chunks.push(stillShown.slice(start, start + ORG_EXPLORER_BATCH_LIMIT));
			}
			const reloaded = await Promise.all(
				chunks.map((chunk) => getOrgExplorerPeople(chunk)),
			);
			if (version !== generation.current) return;
			for (const batch of reloaded) {
				if (!batch.success) throw new Error(batch.error);
				for (const entry of batch.data) fresh.set(entry.employeeId, entry);
			}
		}
		setTeamOffsets(new Map());
		setFailedLoads(new Map());
		setGroupOffsets(new Map());
		setUnknownIds(new Set());
		peopleRef.current = fresh;
		setPeopleById(fresh);
		setSummary(summaryOf(result.data));
	});

	return {
		hasFailedLoads: failedLoads.size > 0,
		isRetrying,
		retryFailed,
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
