"use client";

import { IconClockPause, IconUserCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { kioskFetch, kioskRefusalOf } from "@/lib/kiosk/device";
import type { KioskBoardResponse } from "@/lib/kiosk/protocol";
import { cn } from "@/lib/utils";

/** How often the board refreshes; the spec asks for at least once a minute. */
export const KIOSK_BOARD_REFRESH_MS = 30_000;

type BoardEntry = KioskBoardResponse["entries"][number];

/** Entries carry no identity by design and names can repeat ("Anna B." twice). */
function withKeys(entries: readonly BoardEntry[]) {
	const seen = new Map<string, number>();
	return entries.map((entry) => {
		const occurrence = (seen.get(entry.name) ?? 0) + 1;
		seen.set(entry.name, occurrence);
		return { key: `${entry.name}#${occurrence}`, entry };
	});
}

interface KioskWhoIsInBoardProps {
	token: string;
	onRevoked: () => void;
	onUnpaired: () => void;
}

/**
 * The who-is-in board on the kiosk home screen (#863). Self-contained: it reads
 * `GET /api/kiosk/board` with the device token and refreshes on its own. The
 * server decides whether the board is switched on and shapes the entries (first
 * name, last initial, state), so this only renders them. It shows nothing while
 * the board is off or the server cannot be reached: a stale board would mislead.
 */
export function KioskWhoIsInBoard({ token, onRevoked, onUnpaired }: KioskWhoIsInBoardProps) {
	const { t } = useTranslate();
	const [entries, setEntries] = useState<BoardEntry[] | null>(null);

	const refresh = useEffectEvent(async () => {
		const response = await kioskFetch(token, "/api/kiosk/board").catch(() => null);
		if (!response) {
			setEntries(null);
			return;
		}
		const refusal = await kioskRefusalOf(response);
		if (refusal === "kiosk_revoked") return onRevoked();
		if (refusal === "kiosk_unknown") return onUnpaired();
		const body = response.ok
			? ((await response.json().catch(() => null)) as KioskBoardResponse | null)
			: null;
		setEntries(body?.enabled && Array.isArray(body.entries) ? body.entries : null);
	});

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => void refresh(), KIOSK_BOARD_REFRESH_MS);
		return () => window.clearInterval(timer);
	}, []);

	if (entries === null) return null;

	return (
		<section
			aria-labelledby="kiosk-who-is-in"
			className="@container w-full rounded-xl border bg-card p-4"
		>
			<h2 id="kiosk-who-is-in" className="mb-3 text-lg font-semibold">
				{t("timeTracking.kiosk.board.title", "Who is in")}
			</h2>
			{entries.length === 0 ? (
				<p className="text-muted-foreground">
					{t("timeTracking.kiosk.board.empty", "Nobody is clocked in right now.")}
				</p>
			) : (
				<ul className="grid gap-2 @lg:grid-cols-2">
					{withKeys(entries).map(({ key, entry }) => (
						<li
							key={key}
							className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
						>
							<span className="truncate text-base font-medium">{entry.name}</span>
							<span
								className={cn(
									"inline-flex shrink-0 items-center gap-1 text-sm",
									entry.state === "on_break"
										? "text-amber-700 dark:text-amber-300"
										: "text-emerald-700 dark:text-emerald-300",
								)}
							>
								{entry.state === "on_break" ? (
									<IconClockPause className="size-4" aria-hidden="true" />
								) : (
									<IconUserCheck className="size-4" aria-hidden="true" />
								)}
								{entry.state === "on_break"
									? t("presence.onBreak", "On break")
									: t("presence.clockedIn", "Clocked in")}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
