"use client";

import {
	IconArrowLeft,
	IconCircleCheck,
	IconLoader2,
	IconNfc,
	IconRefresh,
	IconSearch,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { kioskCall } from "@/lib/time-tracking/kiosk/device";
import type {
	KioskEmployeeListing,
	KioskEmployeesResponse,
	KioskFobRegistrationResult,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import { KioskNameGrid, kioskNamesMatching } from "./kiosk-name-grid";

/**
 * The kiosk fob screens (#1505, spec #1358): a read fob being looked up, a fob
 * that selects nobody here (with "Register this fob"), the registration's name
 * pick and its confirmation. The registration's PIN entry is the kiosk PIN pad.
 * Nothing shows more of the serial number than its last four digits.
 */

/** A read fob is being looked up; nothing about anyone shows until Z8 answered. */
export function KioskFobCheck() {
	const { t } = useTranslate();
	return (
		<div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 text-center">
			<output aria-live="polite" aria-busy="true" className="flex flex-col items-center gap-5">
				<IconLoader2
					className="size-16 animate-spin text-muted-foreground motion-reduce:animate-none"
					aria-hidden="true"
				/>
				<span className="text-2xl font-semibold">
					{t("timeTracking.kiosk.fob.checking", "Checking your fob…")}
				</span>
			</output>
		</div>
	);
}

/**
 * The fob selects nobody at this kiosk: unknown, or (never said which) linked
 * to someone who cannot use it here. Its owner may register it.
 */
export function KioskFobUnknown({
	onRegister,
	onBack,
}: {
	onRegister: () => void;
	onBack: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 text-center">
			<IconNfc className="size-20 text-muted-foreground" aria-hidden="true" />
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold">
					{t("timeTracking.kiosk.fob.notRecognised", "This fob is not recognised here.")}
				</h1>
				<p className="text-lg text-muted-foreground">
					{t(
						"timeTracking.kiosk.fob.registerHint",
						"If it is yours, register it with your name and kiosk PIN. A fob you registered before stops working.",
					)}
				</p>
			</div>
			<div className="flex flex-wrap justify-center gap-3">
				<Button size="lg" className="h-16 px-6 text-xl" onClick={onRegister}>
					{t("timeTracking.kiosk.fob.register", "Register this fob")}
				</Button>
				<Button size="lg" variant="outline" className="h-16 px-6 text-xl" onClick={onBack}>
					{t("timeTracking.kiosk.fob.back", "Back")}
				</Button>
			</div>
		</div>
	);
}

type NameList =
	| { state: "loading" }
	| { state: "ready"; employees: KioskEmployeeListing[] }
	| { state: "failed" };

/**
 * Registering a fob: the employee picks their name from the kiosk's employees
 * (those eligible here). Online only, so the list is always fetched afresh.
 */
export function KioskFobNamePick({
	token,
	onPick,
	onBack,
	onKioskRefused,
}: {
	token: string;
	onPick: (employee: KioskEmployeeListing) => void;
	onBack: () => void;
	onKioskRefused: (code: KioskRefusalCode) => void;
}) {
	const { t } = useTranslate();
	const [list, setList] = useState<NameList>({ state: "loading" });
	const [query, setQuery] = useState("");

	function load() {
		void kioskCall<KioskEmployeesResponse>(token, "/api/kiosk/employees").then((result) => {
			if (result.kind === "kiosk") onKioskRefused(result.code);
			else if (result.kind === "ok" && Array.isArray(result.body.employees)) {
				setList({ state: "ready", employees: result.body.employees });
			} else setList({ state: "failed" });
		});
	}

	// The retry button calls load() directly; an Effect Event may only run from Effects.
	const loadOnOpen = useEffectEvent(load);
	useEffect(() => {
		loadOnOpen();
	}, []);

	const shown = list.state === "ready" ? kioskNamesMatching(list.employees, query) : [];

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
			<Button variant="ghost" size="lg" className="h-14 self-start text-lg" onClick={onBack}>
				<IconArrowLeft className="size-6" aria-hidden="true" />
				{t("timeTracking.kiosk.fob.back", "Back")}
			</Button>
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold">
					{t("timeTracking.kiosk.fob.pickTitle", "Register this fob")}
				</h1>
				<p className="text-lg text-muted-foreground">
					{t("timeTracking.kiosk.fob.pickPrompt", "Tap your name.")}
				</p>
			</div>
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
					{t("timeTracking.kiosk.home.noMatch", "No name matches your search.")}
				</p>
			) : null}
			{shown.length > 0 ? <KioskNameGrid employees={shown} onPick={onPick} /> : null}
		</div>
	);
}

/** The fob is linked: whose it is, its last four digits, and whether it replaced an earlier one. */
export function KioskFobRegistered({
	registration,
	onHome,
}: {
	registration: KioskFobRegistrationResult;
	onHome: () => void;
}) {
	const { t } = useTranslate();
	return (
		// The whole screen is a tap target; the button is its accessible equivalent.
		// biome-ignore lint/a11y/noStaticElementInteractions: the Done button offers the same action
		// biome-ignore lint/a11y/useKeyWithClickEvents: the Done button offers the same action
		<div className="flex flex-1 cursor-pointer flex-col" onClick={onHome}>
			<output
				aria-label={t("timeTracking.kiosk.fob.registered", "Fob registered")}
				className="m-auto flex max-w-xl flex-col items-center gap-5 text-center"
			>
				<IconCircleCheck
					className="size-24 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				/>
				<span className="text-3xl font-semibold break-words">{registration.employee.name}</span>
				<span className="text-2xl">
					{registration.outcome === "already_registered"
						? t(
								"timeTracking.kiosk.fob.alreadyRegistered",
								"This fob ending in {lastFour} is already registered to you.",
								{ lastFour: registration.lastFour },
							)
						: t(
								"timeTracking.kiosk.fob.registeredText",
								"Your fob ending in {lastFour} is registered. Tap it to choose your name, then enter your PIN.",
								{ lastFour: registration.lastFour },
							)}
				</span>
				{registration.replaced ? (
					<span className="text-lg text-muted-foreground">
						{t(
							"timeTracking.kiosk.fob.replaced",
							"It replaces your earlier fob, which no longer works.",
						)}
					</span>
				) : null}
				<Button size="lg" className="mt-4 h-16 min-w-48 text-xl" onClick={onHome}>
					{t("timeTracking.kiosk.done.button", "Done")}
				</Button>
			</output>
		</div>
	);
}
