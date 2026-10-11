"use client";

import { IconAlertCircle, IconCalendar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId, useTransition } from "react";
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
import type {
	OverviewPeriod,
	OverviewRow,
	OverviewStatusCounts,
} from "@/lib/time-tracking/period-submissions/overview";
import type { PeriodSubmissionViewStatus } from "@/lib/time-tracking/period-submissions/submission-status";
import { formatPlainDate, formatPlainDateRange } from "@/lib/travel-expenses/format";
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
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const statusLabel = usePeriodSubmissionStatusLabel();
	const pickerId = useId();
	const range = (start: string, end: string) =>
		start === end ? formatPlainDate(locale, start) : formatPlainDateRange(locale, start, end);
	const owing = rows.filter((row) => row.highlighted).length;

	function selectPeriod(startDate: string) {
		startTransition(() => router.push(`${PATH}?period=${encodeURIComponent(startDate)}`));
	}

	return (
		<div className="flex flex-col gap-4" aria-busy={pending}>
			<div className="flex flex-col gap-1.5 sm:max-w-xs">
				<label htmlFor={pickerId} className="text-sm font-medium">
					{t("team.periodSubmissions.period", "Submission period")}
				</label>
				<Select value={selected.startDate} onValueChange={selectPeriod}>
					<SelectTrigger id={pickerId} className="tabular-nums">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{periods.map((period) => (
							<SelectItem key={period.startDate} value={period.startDate} className="tabular-nums">
								{range(period.startDate, period.endDate)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

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
						className="flex flex-wrap gap-2"
						aria-label={t("team.periodSubmissions.summary", "Statuses")}
					>
						{STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
							<li key={status}>
								<Badge variant={STATUS_VARIANTS[status]} className="tabular-nums">
									{statusLabel(status)}: {counts[status]}
								</Badge>
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
						<Table>
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
										<TableCell className="font-medium">
											<span className="inline-flex items-center gap-2">
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
										<TableCell className="tabular-nums">
											{range(row.startDate, row.endDate)}
										</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANTS[row.status]}>{statusLabel(row.status)}</Badge>
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
													<span className="hidden sm:inline">
														{t("team.periodSubmissions.openCalendar", "Calendar")}
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
