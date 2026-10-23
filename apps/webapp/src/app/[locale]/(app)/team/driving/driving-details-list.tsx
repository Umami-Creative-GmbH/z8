"use client";

import { IconCalendar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useTransition } from "react";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatCapturedOffsetInstant } from "@/lib/datetime/temporal-format";
import type { MissingDrivingDetail } from "@/lib/time-tracking/vehicle-use/driving-details-missing";
import type { TeamDrivingDetails } from "@/lib/time-tracking/vehicle-use/driving-details-team-store";
import { Link, useRouter } from "@/navigation";

const PATH = "/team/driving";
const ALL = "all";

export type DrivingDetailsListProps = Pick<
	TeamDrivingDetails,
	"teams" | "employees" | "filters" | "rows" | "truncated"
>;

function useMissingLabel() {
	const { t } = useTranslate();
	return (missing: MissingDrivingDetail) => {
		switch (missing) {
			case "vehicle":
				return t("team.driving.missing.vehicle", "No vehicle");
			case "readings":
				return t("team.driving.missing.readings", "No odometer readings");
			case "start_reading":
				return t("team.driving.missing.startReading", "No start reading");
			case "end_reading":
				return t("team.driving.missing.endReading", "No end reading");
		}
	};
}

/**
 * The work showing "driving details missing" (#1127) for the viewer's employees, newest first,
 * with team and employee filters kept in the URL.
 */
export function DrivingDetailsList({
	teams,
	employees,
	filters,
	rows,
	truncated,
}: DrivingDetailsListProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timeFormat = useTimeFormat();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const missingLabel = useMissingLabel();
	const teamPickerId = useId();
	const employeePickerId = useId();
	const employeeChoices = filters.teamId
		? employees.filter((person) => person.teamId === filters.teamId)
		: employees;

	function navigate(next: { teamId: string | null; employeeId: string | null }) {
		const params = new URLSearchParams();
		if (next.teamId) params.set("team", next.teamId);
		if (next.employeeId) params.set("employee", next.employeeId);
		const query = params.toString();
		startTransition(() => router.push(query ? `${PATH}?${query}` : PATH));
	}

	const at = (instant: string, offsetMinutes: number, preset: "dateMedium" | "time") =>
		formatCapturedOffsetInstant(parseInstant(instant), {
			locale,
			timeFormat,
			offsetMinutes,
			preset,
		});

	return (
		<div className="flex flex-col gap-4" aria-busy={pending}>
			<div className="flex flex-col gap-3 sm:flex-row">
				<div className="flex flex-col gap-1.5 sm:w-56">
					<label htmlFor={teamPickerId} className="text-sm font-medium">
						{t("team.driving.filters.team", "Team")}
					</label>
					<Select
						value={filters.teamId ?? ALL}
						onValueChange={(value) =>
							navigate({ teamId: value === ALL ? null : value, employeeId: null })
						}
					>
						<SelectTrigger id={teamPickerId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>{t("team.driving.filters.allTeams", "All teams")}</SelectItem>
							{teams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-1.5 sm:w-64">
					<label htmlFor={employeePickerId} className="text-sm font-medium">
						{t("team.driving.filters.employee", "Employee")}
					</label>
					<Select
						value={filters.employeeId ?? ALL}
						onValueChange={(value) =>
							navigate({ teamId: filters.teamId, employeeId: value === ALL ? null : value })
						}
					>
						<SelectTrigger id={employeePickerId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL}>
								{t("team.driving.filters.allEmployees", "All employees")}
							</SelectItem>
							{employeeChoices.map((person) => (
								<SelectItem key={person.id} value={person.id}>
									{person.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{rows.length === 0 ? (
				<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
					{t("team.driving.empty", "No work is missing driving details.")}
				</div>
			) : (
				<>
					<p className="text-sm text-muted-foreground">
						{truncated
							? t(
									"team.driving.truncated",
									"Showing the newest {count} work periods. Filter by team or employee to see the rest.",
									{ count: rows.length },
								)
							: t(
									"team.driving.count",
									"{count, plural, one {# work period is} other {# work periods are}} missing driving details.",
									{ count: rows.length },
								)}
					</p>
					<div className="overflow-x-auto rounded-lg border bg-card">
						<Table mobileLayout="stacked">
							<TableHeader>
								<TableRow>
									<TableHead>{t("team.driving.columns.employee", "Employee")}</TableHead>
									<TableHead>{t("team.driving.columns.date", "Date")}</TableHead>
									<TableHead>{t("team.driving.columns.time", "Recorded local time")}</TableHead>
									<TableHead>{t("team.driving.columns.missing", "Missing")}</TableHead>
									<TableHead className="text-right">
										<span className="sr-only">
											{t("team.driving.columns.calendar", "Calendar")}
										</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<TableRow key={row.workPeriodId}>
										<TableCell className="font-medium">
											<div className="flex flex-col">
												<span className="flex flex-wrap items-center gap-2">
													{row.name}
													{row.former ? (
														<Badge variant="secondary">{t("team.driving.former", "Former")}</Badge>
													) : null}
												</span>
												{row.teamName ? (
													<span className="text-xs text-muted-foreground">{row.teamName}</span>
												) : null}
											</div>
										</TableCell>
										<TableCell className="tabular-nums">
											{at(row.startedAt, row.startOffsetMinutes, "dateMedium")}
										</TableCell>
										<TableCell className="tabular-nums">
											{at(row.startedAt, row.startOffsetMinutes, "time")} –{" "}
											{at(row.endedAt, row.endOffsetMinutes ?? row.startOffsetMinutes, "time")}
										</TableCell>
										<TableCell>
											<Badge variant="outline" className="border-amber-500/50">
												{missingLabel(row.missing)}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											<Button asChild variant="ghost" size="sm">
												<Link
													href={`/calendar/${row.employeeId}?date=${row.workDay}`}
													aria-label={t(
														"team.driving.openCalendarOf",
														"Open the calendar of {name}",
														{ name: row.name },
													)}
												>
													<IconCalendar className="size-4" aria-hidden="true" />
													<span className="hidden sm:inline">
														{t("team.driving.openCalendar", "Calendar")}
													</span>
												</Link>
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</>
			)}
		</div>
	);
}
