"use client";

import { IconArrowLeft, IconCircleCheck, IconLoader2, IconNfc } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { kioskCall } from "@/lib/time-tracking/kiosk/device";
import type {
	KioskEmployeeListing,
	KioskEmployeesResponse,
	KioskFobRegistrationResult,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import { KioskConfirmationShell } from "./kiosk-confirmation";
import { type KioskNameListOutcome, KioskNamePicker, useKioskNameList } from "./kiosk-name-grid";

/**
 * The kiosk fob screens (#1505, spec #1358): a read fob being looked up, a fob
 * that selects nobody here (with "Register this fob"), the registration's name
 * pick and its confirmation. The registration's PIN entry is the kiosk PIN pad.
 * Nothing shows more of the serial number than its last four characters.
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

/** The kiosk's employees, always fetched afresh: fob registration is online only. */
async function fetchOnlineEmployees(token: string): Promise<KioskNameListOutcome> {
	const result = await kioskCall<KioskEmployeesResponse>(token, "/api/kiosk/employees");
	if (result.kind === "kiosk") return { state: "refused", code: result.code };
	if (result.kind === "ok" && Array.isArray(result.body.employees)) {
		return { state: "ready", employees: result.body.employees };
	}
	return { state: "failed" };
}

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
	const { list, retry } = useKioskNameList(() => fetchOnlineEmployees(token), onKioskRefused);
	const [query, setQuery] = useState("");

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
			<KioskNamePicker
				list={list}
				query={query}
				onQueryChange={setQuery}
				onRetry={retry}
				onPick={onPick}
			/>
		</div>
	);
}

/** The fob is linked: whose it is, its last four characters, and whether it replaced an earlier one. */
export function KioskFobRegistered({
	registration,
	onHome,
}: {
	registration: KioskFobRegistrationResult;
	onHome: () => void;
}) {
	const { t } = useTranslate();
	return (
		<KioskConfirmationShell
			label={t("timeTracking.kiosk.fob.registered", "Fob registered")}
			onHome={onHome}
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
		</KioskConfirmationShell>
	);
}
