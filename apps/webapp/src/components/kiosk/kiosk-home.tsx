"use client";

import {
	IconCamera,
	IconLoader2,
	IconMapPin,
	IconQrcode,
	IconRefresh,
	IconSearch,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kioskCall } from "@/lib/time-tracking/kiosk/device";
import {
	readOfflineEmployees,
	rememberKioskEmployees,
} from "@/lib/time-tracking/kiosk/offline-device";
import type {
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeesResponse,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import { KioskLanguageSwitch } from "./kiosk-language";
import { useKioskHomeNoticeMessage } from "./kiosk-messages";
import type { KioskHomeNotice } from "./kiosk-turn-flow";
import { KioskWhoIsInBoard } from "./kiosk-who-is-in-board";
import { useKioskBadgeScanner } from "./use-kiosk-badge-scanner";

type EmployeeList =
	| { state: "loading" }
	| { state: "ready"; employees: KioskEmployeeListing[] }
	| { state: "failed" };

/** Case- and accent-insensitive, so "ozd" finds "Özdemir". */
function searchable(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase();
}

/** Whether a name contains the already-`searchable` search text. */
function nameMatches(name: string, needle: string) {
	return searchable(name).includes(needle);
}

type EmployeeListOutcome =
	| Exclude<EmployeeList, { state: "loading" }>
	| { state: "refused"; code: KioskRefusalCode };

/**
 * Fetches the location's employees. A reached server's list is cached for an
 * offline-mode kiosk (#1291), which falls back to that cache when the server
 * cannot be reached.
 */
async function fetchEmployeeList(
	token: string,
	kiosk: KioskDeviceInfo,
): Promise<EmployeeListOutcome> {
	const result = await kioskCall<KioskEmployeesResponse>(token, "/api/kiosk/employees");
	if (result.kind === "kiosk") return { state: "refused", code: result.code };
	if (result.kind === "ok" && Array.isArray(result.body.employees)) {
		void rememberKioskEmployees(kiosk, result.body);
		return { state: "ready", employees: result.body.employees };
	}
	const cached = kiosk.offlineMode ? await readOfflineEmployees(kiosk.id) : null;
	if (!cached) return { state: "failed" };
	return {
		state: "ready",
		employees: cached.map((employee) => ({ id: employee.id, name: employee.name })),
	};
}

function initials(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return letters.map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? "").join("");
}

interface KioskHomeProps {
	token: string;
	kiosk: KioskDeviceInfo;
	/** An offline-mode kiosk's successful contacts (#1291): each one reloads the list and its cache. */
	contacts?: number;
	/** An offline-mode kiosk without a connection: no language switch, whose page may not be cached. */
	offline?: boolean;
	locale: string;
	/** Why the last badge scan or badge turn did not go through (#1366). */
	notice?: KioskHomeNotice | null;
	/**
	 * A badge read on this screen (#1366). Given only while the kiosk accepts
	 * badges; the attached scanner feeds it, as any later badge input would.
	 */
	onBadge?: (credential: string) => void;
	/** A scanned code that is no kiosk badge. */
	onBadgeUnreadable?: () => void;
	/**
	 * "Scan badge" with the kiosk's camera (#1367). Given only while the kiosk's
	 * camera input is on; the camera opens from this button alone.
	 */
	onScanBadge?: () => void;
	onChooseLanguage: (language: string) => void;
	onPick: (employee: KioskEmployeeListing) => void;
	onKioskRefused: (code: KioskRefusalCode) => void;
}

/**
 * The kiosk home screen (#862): the kiosk and its location, a searchable list
 * of the employees assigned to the location and, when switched on, the
 * who-is-in board (#863). The list is fetched each time the home screen opens
 * and lives only as long as it shows. An offline-mode kiosk (#1291) also
 * fetches it at each contact, caches it with the employees' states, and shows
 * the cached list when the server cannot be reached.
 */
export function KioskHome({
	token,
	kiosk,
	contacts = 0,
	offline = false,
	locale,
	notice = null,
	onBadge,
	onBadgeUnreadable,
	onScanBadge,
	onChooseLanguage,
	onPick,
	onKioskRefused,
}: KioskHomeProps) {
	const { t } = useTranslate();
	const noticeMessage = useKioskHomeNoticeMessage(kiosk.offlineMode);
	const [list, setList] = useState<EmployeeList>({ state: "loading" });
	const [query, setQuery] = useState("");
	// What the search said before a scan's keys may have reached it (#1366).
	const queryBeforeScan = useRef("");
	useKioskBadgeScanner({
		mode: onBadge ? "read" : "off",
		onBadge,
		onUnreadable: onBadgeUnreadable,
		onScanStart: () => {
			queryBeforeScan.current = query;
		},
		onScanEnd: () => setQuery(queryBeforeScan.current),
	});

	function show(outcome: EmployeeListOutcome) {
		if (outcome.state === "refused") onKioskRefused(outcome.code);
		else setList(outcome);
	}

	function load() {
		void fetchEmployeeList(token, kiosk).then(show);
	}

	// The retry button calls load() directly; an Effect Event may only run from Effects.
	const loadOnContact = useEffectEvent(load);

	// biome-ignore lint/correctness/useExhaustiveDependencies: each contact reloads the list
	useEffect(() => {
		loadOnContact();
	}, [contacts]);

	const needle = searchable(query.trim());
	const shown =
		list.state === "ready"
			? list.employees.filter((employee) => nameMatches(employee.name, needle))
			: [];

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
			<header className="flex flex-wrap items-center justify-between gap-4">
				<div className="min-w-0">
					<h1 className="truncate text-3xl font-semibold">{kiosk.name}</h1>
					<p className="flex items-center gap-1 text-lg text-muted-foreground">
						<IconMapPin className="size-5 shrink-0" aria-hidden="true" />
						<span className="truncate">{kiosk.locationName}</span>
					</p>
				</div>
				<KioskLanguageSwitch locale={locale} disabled={offline} onChoose={onChooseLanguage} />
			</header>

			<div className="grid flex-1 content-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<section aria-labelledby="kiosk-employees" className="flex min-w-0 flex-col gap-4">
					<h2 id="kiosk-employees" className="text-xl font-semibold">
						{t("timeTracking.kiosk.home.title", "Tap your name to clock in or out")}
					</h2>
					{onScanBadge ? (
						<Button size="lg" className="h-16 self-start px-6 text-xl" onClick={onScanBadge}>
							<IconCamera className="size-6" aria-hidden="true" />
							{t("timeTracking.kiosk.home.scanBadge", "Scan badge")}
						</Button>
					) : null}
					{onBadge ? (
						<p className="-mt-2 flex items-center gap-2 text-lg text-muted-foreground">
							<IconQrcode className="size-6 shrink-0" aria-hidden="true" />
							{t("timeTracking.kiosk.home.scanHint", "Or scan your kiosk badge at the scanner.")}
						</p>
					) : null}
					{notice ? (
						<p
							role="alert"
							className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100"
						>
							{noticeMessage(notice)}
						</p>
					) : null}
					<div className="relative">
						<IconSearch
							className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
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
							<Button
								size="lg"
								variant="outline"
								className="h-14 text-lg"
								onClick={() => {
									setList({ state: "loading" });
									load();
								}}
							>
								<IconRefresh className="size-5" aria-hidden="true" />
								{t("timeTracking.kiosk.retry", "Try again")}
							</Button>
						</div>
					) : null}
					{list.state === "ready" && shown.length === 0 ? (
						<p className="py-6 text-lg text-muted-foreground">
							{list.employees.length === 0
								? t(
										"timeTracking.kiosk.home.empty",
										"Nobody is assigned to this location yet. Ask your admin.",
									)
								: t("timeTracking.kiosk.home.noMatch", "No name matches your search.")}
						</p>
					) : null}
					{shown.length > 0 ? (
						<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{shown.map((employee) => (
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
					) : null}
				</section>
				{kiosk.boardEnabled && !offline ? (
					<aside className="min-w-0">
						<KioskWhoIsInBoard
							token={token}
							onRevoked={() => onKioskRefused("kiosk_revoked")}
							onUnpaired={() => onKioskRefused("kiosk_unknown")}
						/>
					</aside>
				) : null}
			</div>
		</div>
	);
}
