"use client";

import { IconClockPause, IconUserCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "@/navigation";

/** How often the manager view reloads its server data. */
const PRESENCE_REFRESH_MS = 60_000;

export type LocationPresenceRow = {
	employeeId: string;
	name: string;
	state: "clocked_in" | "on_break";
	/** "Since", formatted on the server in the zone captured at that moment. */
	sinceText: string;
};

/** The manager view's list of who is in at one location (#863), refreshed every minute. */
export function LocationPresenceList({ rows }: { rows: LocationPresenceRow[] }) {
	const { t } = useTranslate();
	const router = useRouter();

	useEffect(() => {
		const timer = window.setInterval(() => router.refresh(), PRESENCE_REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [router]);

	if (rows.length === 0) {
		return (
			<div className="rounded-lg border bg-card p-6 text-center text-muted-foreground text-sm">
				{t("team.presence.empty", "Nobody you can see is clocked in at this location right now.")}
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<table className="w-full text-sm">
				<thead className="bg-muted/50 text-left text-muted-foreground">
					<tr>
						<th scope="col" className="px-4 py-2 font-medium">
							{t("team.presence.columns.name", "Name")}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{t("team.presence.columns.state", "State")}
						</th>
						<th scope="col" className="px-4 py-2 font-medium">
							{t("team.presence.columns.since", "Since")}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.employeeId} className="border-t">
							<td className="px-4 py-3 font-medium">{row.name}</td>
							<td className="px-4 py-3">
								{row.state === "on_break" ? (
									<Badge
										variant="outline"
										className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300"
									>
										<IconClockPause className="size-3.5" aria-hidden="true" />
										{t("presence.onBreak", "On break")}
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
									>
										<IconUserCheck className="size-3.5" aria-hidden="true" />
										{t("presence.clockedIn", "Clocked in")}
									</Badge>
								)}
							</td>
							<td className="px-4 py-3 tabular-nums">{row.sinceText}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
