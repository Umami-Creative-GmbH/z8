"use client";

import { IconAlertCircle, IconCalendar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useMemo, useTransition } from "react";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
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
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type {
	OverviewPeriod,
	OverviewRow,
	OverviewStatusCounts,
} from "@/lib/time-tracking/period-submissions/overview";
import type { PeriodSubmissionViewStatus } from "@/lib/time-tracking/period-submissions/submission-status";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/navigation";

const PATH = "/team/period-submissions";

const STATUS_ORDER: readonly PeriodSubmissionViewStatus[] = [
	"awaiting_submission",
	"rejected",
	"sent_back_after_change",
	"submitted",
	"approved",
];

const STATUS_VARIANTS: Record<
	PeriodSubmissionViewStatus,
	"default" | "secondary" | "destructive" | "outline"
> = {
	awaiting_submission: "outline",
	submitted: "secondary",
	approved: "default",
	rejected: "destructive",
	sent_back_after_change: "destructive",
};

export interface PeriodSubmissionOverviewProps {
	periods: OverviewPeriod[];
	selected: OverviewPeriod;
	running: boolean;
	rows: OverviewRow[];
	counts: OverviewStatusCounts;
}

function usePeriodSubmissionStatusLabel() {
	const { t } = useTranslate();
	return (status: PeriodSubmissionViewStatus) => {
		switch (status) {
			case "awaiting_submission":
				return t("team.periodSubmissions.status.awaiting", "Awaiting submission");
			case "submitted":
				return t("team.periodSubmissions.status.submitted", "Submitted");
			case "approved":
				return t("team.periodSubmissions.status.approved", "Approved");
			case "rejected":
				return t("team.periodSubmissions.status.rejected", "Rejected");
			case "sent_back_after_change":
				return t("team.periodSubmissions.status.sentBack", "Sent back after a change");
		}
	};
}

/**
 * The period submission status overview (#1063): one selected submission period, every covered
 * employee in the viewer's scope with their status, and those who still owe the period
 * highlighted. Read-only; deciding happens in the approval inbox.
 */
export function PeriodSubmissionOverview({
	periods,
	selected,
	running,
	rows,
	counts,
}: PeriodSubmissionOverviewProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const statusLabel = usePeriodSubmissionStatusLabel();
	const pickerId = useId();
	const range = (start: string, end: string) =>
		formatPlainDateRange(parsePlainDate(start), parsePlainDate(end), locale, "dateMedium");
	const owing = rows.filter((row) => row.highlighted).length;

	function selectPeriod(startDate: string) {
		startTransition(() => router.push(`${PATH}?period=${encodeURIComponent(startDate)}`));
	}

	return (
		<div className="flex flex-col gap-4" aria-busy={pending}>
			<DataTableToolbar
				filterControls={
					<div className="flex w-full flex-col gap-1.5 sm:max-w-sm">
						<label htmlFor={pickerId} className="text-sm font-medium">
							{t("team.periodSubmissions.period", "Submission period")}
						</label>
						<Select value={selected.startDate} onValueChange={selectPeriod} disabled={pending}>
							<SelectTrigger id={pickerId} className="w-full tabular-nums">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{periods.map((period) => (
									<SelectItem
										key={period.startDate}
										value={period.startDate}
										className="tabular-nums"
									>
										{range(period.startDate, period.endDate)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				}
			/>

			{running ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"team.periodSubmissions.running",
						"This period is still running. Employees can submit it from its last day.",
					)}
				</p>
			) : null}

			{rows.length === 0 ? (
				<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
					{t(
						"team.periodSubmissions.empty",
						"No one you can see is expected to submit this period.",
					)}
				</div>
			) : (
				<>
					<ul
						className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-card p-4 sm:grid-cols-3 xl:grid-cols-5"
						aria-label={t("team.periodSubmissions.summary", "Statuses")}
					>
						{STATUS_ORDER.map((status) => (
							<li
								key={status}
								className="flex min-w-0 items-baseline justify-between gap-3 sm:block sm:space-y-1"
							>
								<p className="text-sm text-muted-foreground">{statusLabel(status)}</p>
								<p className="text-lg font-semibold tabular-nums sm:text-2xl">
									{number.format(counts[status])}
								</p>
							</li>
						))}
					</ul>
					{owing > 0 ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"team.periodSubmissions.owing",
								"{count, plural, one {# employee has} other {# employees have}} not submitted this period yet.",
								{ count: owing },
							)}
						</p>
					) : null}
					<div className="overflow-hidden rounded-lg border bg-card">
						<Table
							mobileLayout="stacked"
							aria-label={t("team.periodSubmissions.records", "Employee submissions")}
						>
							<TableHeader>
								<TableRow>
									<TableHead>{t("team.periodSubmissions.columns.employee", "Employee")}</TableHead>
									<TableHead>{t("team.periodSubmissions.columns.period", "Period")}</TableHead>
									<TableHead>{t("team.periodSubmissions.columns.status", "Status")}</TableHead>
									<TableHead className="text-right">
										<span className="sr-only">
											{t("team.periodSubmissions.columns.calendar", "Calendar")}
										</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<TableRow
										key={row.employeeId}
										className={cn(row.highlighted && "bg-amber-50 dark:bg-amber-950/30")}
									>
										<TableCell className="whitespace-normal font-medium">
											<span className="inline-flex items-center gap-2 break-words">
												{row.highlighted ? (
													<IconAlertCircle
														className="size-4 text-amber-600 dark:text-amber-400"
														aria-hidden="true"
													/>
												) : null}
												{row.name}
												{row.highlighted ? (
													<span className="sr-only">
														{t("team.periodSubmissions.notSubmitted", "Not submitted")}
													</span>
												) : null}
											</span>
										</TableCell>
										<TableCell className="whitespace-normal tabular-nums">
											{range(row.startDate, row.endDate)}
										</TableCell>
										<TableCell>
											<Badge className="whitespace-normal" variant={STATUS_VARIANTS[row.status]}>
												{statusLabel(row.status)}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											<Button asChild variant="ghost" size="sm">
												<Link
													href={`/calendar/${row.employeeId}?date=${row.startDate}`}
													aria-label={t(
														"team.periodSubmissions.openCalendarOf",
														"Open the calendar of {name}",
														{ name: row.name },
													)}
												>
													<IconCalendar className="size-4" aria-hidden="true" />
													<span>{t("team.periodSubmissions.openCalendar", "Calendar")}</span>
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
