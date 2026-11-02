"use client";

import { IconLoader2, IconRefresh, IconSearch } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KioskEmployeeListing, KioskRefusalCode } from "@/lib/time-tracking/kiosk/protocol";

/** The kiosk's employees as a name list shows them. */
export type KioskNameList =
	| { state: "loading" }
	| { state: "ready"; employees: KioskEmployeeListing[] }
	| { state: "failed" };

/** A fetch of the list: the list, or the kiosk's own refusal (revoked, unpaired). */
export type KioskNameListOutcome =
	| Exclude<KioskNameList, { state: "loading" }>
	| { state: "refused"; code: KioskRefusalCode };

/**
 * The kiosk's employees, fetched when the list first shows and again whenever
 * `reloadKey` changes; `retry` fetches them again after a failure. A refusal
 * of the kiosk itself goes to `onKioskRefused` instead.
 */
export function useKioskNameList(
	fetchList: () => Promise<KioskNameListOutcome>,
	onKioskRefused: (code: KioskRefusalCode) => void,
	reloadKey: unknown = null,
) {
	const [list, setList] = useState<KioskNameList>({ state: "loading" });

	function load() {
		void fetchList().then((outcome) => {
			if (outcome.state === "refused") onKioskRefused(outcome.code);
			else setList(outcome);
		});
	}

	// The retry button calls load() directly; an Effect Event may only run from Effects.
	const loadOnChange = useEffectEvent(load);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each reloadKey change reloads the list
	useEffect(() => {
		loadOnChange();
	}, [reloadKey]);

	return {
		list,
		retry() {
			setList({ state: "loading" });
			load();
		},
	};
}

/** Case- and accent-insensitive, so "ozd" finds "Özdemir". */
export function searchableKioskName(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase();
}

/** The employees whose name contains the search text, as typed. */
export function kioskNamesMatching(employees: KioskEmployeeListing[], query: string) {
	const needle = searchableKioskName(query.trim());
	return employees.filter((employee) => searchableKioskName(employee.name).includes(needle));
}

function initials(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return letters.map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? "").join("");
}

/**
 * The kiosk's employees as big name buttons (#862): the home screen's list and
 * (#1505) the name pick of a fob registration.
 */
export function KioskNameGrid({
	employees,
	onPick,
}: {
	employees: KioskEmployeeListing[];
	onPick: (employee: KioskEmployeeListing) => void;
}) {
	return (
		<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{employees.map((employee) => (
				<li key={employee.id}>
					<button
						type="button"
						onClick={() => onPick(employee)}
						className="flex min-h-20 w-full items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left text-xl font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent"
					>
						<span
							aria-hidden="true"
							className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary"
						>
							{initials(employee.name)}
						</span>
						<span className="min-w-0 break-words">{employee.name}</span>
					</button>
				</li>
			))}
		</ul>
	);
}

/**
 * The searchable name list (#862) of the home screen and (#1505) a fob
 * registration's name pick: the search box, the loading, failed (with retry)
 * and no-match states, then the names. `emptyText` is said when nobody is on
 * the list at all; otherwise that no name matches the search.
 */
export function KioskNamePicker({
	list,
	query,
	onQueryChange,
	onRetry,
	onPick,
	emptyText,
}: {
	list: KioskNameList;
	query: string;
	onQueryChange: (query: string) => void;
	onRetry: () => void;
	onPick: (employee: KioskEmployeeListing) => void;
	emptyText?: string;
}) {
	const { t } = useTranslate();
	const shown = list.state === "ready" ? kioskNamesMatching(list.employees, query) : [];
	const noMatch = t("timeTracking.kiosk.home.noMatch", "No name matches your search.");
	return (
		<>
			<div className="relative">
				<IconSearch
					className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					type="search"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					aria-label={t("timeTracking.kiosk.home.search", "Find your name")}
					placeholder={t("timeTracking.kiosk.home.search", "Find your name")}
					autoComplete="off"
					className="h-14 pl-14 text-xl md:text-xl"
				/>
			</div>
			{list.state === "loading" ? (
				<output
					aria-busy="true"
					className="flex items-center gap-3 py-8 text-lg text-muted-foreground"
				>
					<IconLoader2
						className="size-6 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
					{t("timeTracking.kiosk.home.loading", "Loading names…")}
				</output>
			) : null}
			{list.state === "failed" ? (
				<div className="flex flex-col items-start gap-3 py-6" role="alert">
					<p className="text-lg">
						{t(
							"timeTracking.kiosk.home.loadFailed",
							"The names could not be loaded. Check the network connection.",
						)}
					</p>
					<Button size="lg" variant="outline" className="h-14 text-lg" onClick={onRetry}>
						<IconRefresh className="size-5" aria-hidden="true" />
						{t("timeTracking.kiosk.retry", "Try again")}
					</Button>
				</div>
			) : null}
			{list.state === "ready" && shown.length === 0 ? (
				<p className="py-6 text-lg text-muted-foreground">
					{list.employees.length === 0 ? (emptyText ?? noMatch) : noMatch}
				</p>
			) : null}
			{shown.length > 0 ? <KioskNameGrid employees={shown} onPick={onPick} /> : null}
		</>
	);
}
