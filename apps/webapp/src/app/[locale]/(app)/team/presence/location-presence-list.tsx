"use client";

import { IconClockPause, IconUserCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/navigation";

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
			<div className="rounded-lg border bg-card px-6 py-12 text-center text-muted-foreground text-sm">
				{t("team.presence.empty", "Nobody you can see is clocked in at this location right now.")}
			</div>
		);
	}

	return (
		<div className="min-w-0 rounded-lg border bg-card">
			<Table mobileLayout="stacked" aria-label={t("team.presence.title", "Who is in")}>
				<TableHeader className="bg-muted/40">
					<TableRow>
						<TableHead scope="col" className="px-4 text-muted-foreground">
							{t("team.presence.columns.name", "Name")}
						</TableHead>
						<TableHead scope="col" className="px-4 text-muted-foreground">
							{t("team.presence.columns.state", "State")}
						</TableHead>
						<TableHead scope="col" className="px-4 text-muted-foreground">
							{t("team.presence.columns.since", "Since")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.employeeId}>
							<TableCell className="whitespace-normal break-words px-4 py-3 font-medium">
								<Link
									href={`/settings/employees/${row.employeeId}`}
									className="inline-flex min-h-9 items-center rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
								>
									{row.name}
								</Link>
							</TableCell>
							<TableCell className="px-4 py-3 max-sm:col-span-full">
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
							</TableCell>
							<TableCell className="whitespace-normal px-4 py-3 tabular-nums">
								{row.sinceText}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
