"use client";

import { IconCamera, IconMapPin, IconNfc, IconQrcode } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { type KioskNameListOutcome, KioskNamePicker, useKioskNameList } from "./kiosk-name-grid";
import type { KioskHomeNotice } from "./kiosk-turn-flow";
import { KioskWhoIsInBoard } from "./kiosk-who-is-in-board";
import { useKioskReaderInput } from "./use-kiosk-reader-input";

/**
 * Fetches the location's employees. A reached server's list is cached for an
 * offline-mode kiosk (#1291), which falls back to that cache when the server
 * cannot be reached.
 */
async function fetchEmployeeList(
	token: string,
	kiosk: KioskDeviceInfo,
): Promise<KioskNameListOutcome> {
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
	 * A kiosk fob's serial number read on this screen (#1505), given only while
	 * the kiosk's NFC fob reader is on. Other screens never read fobs.
	 */
	onFob?: (serial: string) => void;
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
	onFob,
	onScanBadge,
	onChooseLanguage,
	onPick,
	onKioskRefused,
}: KioskHomeProps) {
	const { t } = useTranslate();
	const noticeMessage = useKioskHomeNoticeMessage(kiosk.offlineMode);
	// Each contact reloads the list.
	const { list, retry } = useKioskNameList(
		() => fetchEmployeeList(token, kiosk),
		onKioskRefused,
		contacts,
	);
	const [query, setQuery] = useState("");
	// What the search said before a scan's keys may have reached it (#1366).
	const queryBeforeScan = useRef("");
	useKioskReaderInput({
		mode: onBadge || onFob ? "read" : "off",
		onBadge,
		onFob,
		onUnreadable: onBadgeUnreadable,
		onScanStart: () => {
			queryBeforeScan.current = query;
		},
		onScanEnd: () => setQuery(queryBeforeScan.current),
	});

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
					{onFob ? (
						<p className="-mt-2 flex items-center gap-2 text-lg text-muted-foreground">
							<IconNfc className="size-6 shrink-0" aria-hidden="true" />
							{t("timeTracking.kiosk.home.fobHint", "Or tap your fob on the reader.")}
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
					<KioskNamePicker
						list={list}
						query={query}
						onQueryChange={setQuery}
						onRetry={retry}
						onPick={onPick}
						emptyText={t(
							"timeTracking.kiosk.home.empty",
							"Nobody is assigned to this location yet. Ask your admin.",
						)}
					/>
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
