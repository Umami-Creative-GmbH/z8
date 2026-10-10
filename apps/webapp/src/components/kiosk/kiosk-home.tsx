"use client";

import { IconLoader2, IconMapPin, IconRefresh, IconSearch } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kioskCall } from "@/lib/time-tracking/kiosk/device";
import type {
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeesResponse,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import { KioskLanguageSwitch } from "./kiosk-language";
import { KioskWhoIsInBoard } from "./kiosk-who-is-in-board";

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

function initials(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return letters.map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? "").join("");
}

interface KioskHomeProps {
	token: string;
	kiosk: KioskDeviceInfo;
	locale: string;
	onChooseLanguage: (language: string) => void;
	onPick: (employee: KioskEmployeeListing) => void;
	onKioskRefused: (code: KioskRefusalCode) => void;
}

/**
 * The kiosk home screen (#862): the kiosk and its location, a searchable list
 * of the employees assigned to the location and, when switched on, the
 * who-is-in board (#863). The list is fetched each time the home screen opens
 * and lives only as long as it shows.
 */
export function KioskHome({
	token,
	kiosk,
	locale,
	onChooseLanguage,
	onPick,
	onKioskRefused,
}: KioskHomeProps) {
	const { t } = useTranslate();
	const [list, setList] = useState<EmployeeList>({ state: "loading" });
	const [query, setQuery] = useState("");

	const load = useEffectEvent(async () => {
		const result = await kioskCall<KioskEmployeesResponse>(token, "/api/kiosk/employees");
		if (result.kind === "kiosk") return onKioskRefused(result.code);
		if (result.kind === "ok" && Array.isArray(result.body.employees)) {
			setList({ state: "ready", employees: result.body.employees });
		} else {
			setList({ state: "failed" });
		}
	});

	useEffect(() => {
		void load();
	}, []);

	const needle = searchable(query.trim());
	const shown =
		list.state === "ready"
			? list.employees.filter((employee) => searchable(employee.name).includes(needle))
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
				<KioskLanguageSwitch locale={locale} onChoose={onChooseLanguage} />
			</header>

			<div className="grid flex-1 content-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<section aria-labelledby="kiosk-employees" className="flex min-w-0 flex-col gap-4">
					<h2 id="kiosk-employees" className="text-xl font-semibold">
						{t("timeTracking.kiosk.home.title", "Tap your name to clock in or out")}
					</h2>
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
									void load();
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
				{kiosk.boardEnabled ? (
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
