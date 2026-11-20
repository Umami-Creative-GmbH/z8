"use client";

import { IconAlertTriangle, IconCalendarEvent, IconConfetti } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { getPayrollDayRecordsAction } from "@/app/[locale]/(app)/payroll/actions";
import { absenceCategoryColor } from "@/components/absences/category-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type {
	PayrollPeriodDay,
	PayrollPeriodDayRecord,
	PayrollPeriodEmployee,
} from "@/lib/payroll-period/types";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { absencePeriodLabel, type PayrollDaysFormat } from "./payroll-days-grid";
import type { PayrollTranslate } from "./state";

export interface PayrollDaySelection {
	employee: PayrollPeriodEmployee;
	day: PayrollPeriodDay;
}

/**
 * The read-only side panel of one employee-day (#1894): the day's figures, absences and
 * holiday from the period read, the work and break records behind them in the employee's
 * timezone, and a link to the employee's calendar, where corrections are made. No time
 * data can be changed here; the settlement slot (#1897) can only unsettle the day.
 */
export function PayrollDayPanel({
	format,
	onClose,
	refreshedAt,
	selection,
	settlementHistory,
	t,
}: {
	format: PayrollDaysFormat;
	onClose: () => void;
	refreshedAt: string;
	selection: PayrollDaySelection | null;
	/** Slot for the day's settlement history (#1897); nothing is shown without it. */
	settlementHistory?: ReactNode;
	t: PayrollTranslate;
}) {
	return (
		<Sheet open={selection !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-md">
				{selection ? (
					<PayrollDayPanelContent
						format={format}
						refreshedAt={refreshedAt}
						selection={selection}
						settlementHistory={settlementHistory}
						t={t}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function PayrollDayPanelContent({
	format,
	refreshedAt,
	selection,
	settlementHistory,
	t,
}: {
	format: PayrollDaysFormat;
	refreshedAt: string;
	selection: PayrollDaySelection;
	settlementHistory?: ReactNode;
	t: PayrollTranslate;
}) {
	const { employee, day } = selection;
	const calendarHref = `/calendar/${encodeURIComponent(employee.id)}?date=${encodeURIComponent(day.date)}`;
	return (
		<>
			<SheetHeader>
				<SheetTitle>{employee.name}</SheetTitle>
				<SheetDescription>
					{format.longDate(day.date)}
					{employee.departure ? (
						<>
							{" · "}
							{t("payroll.days.leftOn", "Left on {date}", {
								date: format.shortDate(employee.departure.lastWorkingDay),
							})}
						</>
					) : null}
				</SheetDescription>
			</SheetHeader>
			<div className="flex flex-col gap-5 px-4 pb-4">
				<dl className="grid grid-cols-3 gap-2 rounded-lg border bg-background p-3 text-sm tabular-nums">
					<Figure label={t("payroll.days.panel.worked", "Worked")}>
						{format.hours(day.creditedMinutes)} h
					</Figure>
					<Figure label={t("payroll.days.panel.required", "Required")}>
						{day.requiredMinutes === null ? "–" : `${format.hours(day.requiredMinutes)} h`}
					</Figure>
					<Figure label={t("payroll.days.panel.difference", "Difference")}>
						<span
							className={cn(
								(day.differenceMinutes ?? 0) > 0 && "text-emerald-700 dark:text-emerald-400",
								(day.differenceMinutes ?? 0) < 0 && "text-rose-700 dark:text-rose-400",
							)}
						>
							{day.differenceMinutes === null
								? "–"
								: `${format.difference(day.differenceMinutes)} h`}
						</span>
					</Figure>
				</dl>

				{day.absences.length > 0 || day.holiday ? (
					<section className="flex flex-col gap-2">
						<h3 className="font-medium text-sm">
							{t("payroll.days.panel.absenceAndHoliday", "Absence and holiday")}
						</h3>
						<ul className="flex flex-col gap-1.5 text-sm">
							{day.absences.map((absence) => (
								<li key={absence.absenceId} className="flex flex-wrap items-center gap-2">
									<span
										aria-hidden="true"
										className="size-2.5 shrink-0 rounded-full"
										style={{
											backgroundColor: absenceCategoryColor(
												absence.categoryType,
												absence.categoryColor,
											),
										}}
									/>
									<span>{absence.categoryName}</span>
									{absencePeriodLabel(absence.period, t) ? (
										<span className="text-muted-foreground">
											{absencePeriodLabel(absence.period, t)}
										</span>
									) : null}
									{absence.approvalState === "pending" ? (
										<Badge variant="outline">{t("payroll.days.panel.pending", "Pending")}</Badge>
									) : null}
								</li>
							))}
							{day.holiday ? (
								<li className="flex items-center gap-2">
									<IconConfetti aria-hidden="true" className="size-4 text-amber-600" />
									<span>{day.holiday.name}</span>
								</li>
							) : null}
						</ul>
					</section>
				) : null}

				<PayrollDayRecords
					employeeId={employee.id}
					date={day.date}
					format={format}
					refreshedAt={refreshedAt}
					t={t}
				/>

				{settlementHistory}

				<Button asChild variant="outline" className="w-full">
					<Link href={calendarHref}>
						<IconCalendarEvent aria-hidden="true" />
						{t("payroll.days.panel.openCalendar", "Open calendar to make corrections")}
					</Link>
				</Button>
			</div>
		</>
	);
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="font-medium">{children}</dd>
		</div>
	);
}

function PayrollDayRecords({
	date,
	employeeId,
	format,
	refreshedAt,
	t,
}: {
	date: string;
	employeeId: string;
	format: PayrollDaysFormat;
	refreshedAt: string;
	t: PayrollTranslate;
}) {
	const { data, error, isPending } = useQuery({
		queryKey: queryKeys.payroll.dayRecords({ employeeId, date, refreshedAt }),
		queryFn: async () => {
			const result = await getPayrollDayRecordsAction({ employeeId, date });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		staleTime: Number.POSITIVE_INFINITY,
	});

	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-medium text-sm">
				{t("payroll.days.panel.records", "Work and break records")}
			</h3>
			{error ? (
				<p className="flex items-center gap-2 text-destructive text-sm">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					{t("payroll.days.panel.recordsFailed", "The records could not be loaded.")}
				</p>
			) : isPending || !data ? (
				<div className="flex flex-col gap-1.5" aria-busy="true">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : data.records.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("payroll.days.panel.noRecords", "No work or break records on this day.")}
				</p>
			) : (
				<>
					<ul className="flex flex-col divide-y rounded-lg border bg-background text-sm">
						{data.records.map((record) => (
							<PayrollDayRecordRow
								key={record.id}
								date={date}
								format={format}
								record={record}
								t={t}
							/>
						))}
					</ul>
					<p className="text-muted-foreground text-xs">
						{t("payroll.days.panel.timezone", "Times in the employee's timezone ({timezone}).", {
							timezone: data.timezone,
						})}
					</p>
				</>
			)}
		</section>
	);
}

function PayrollDayRecordRow({
	date,
	format,
	record,
	t,
}: {
	date: string;
	format: PayrollDaysFormat;
	record: PayrollPeriodDayRecord;
	t: PayrollTranslate;
}) {
	return (
		<li className="flex items-center justify-between gap-3 px-3 py-2">
			<div className="flex min-w-0 flex-col">
				<span className="font-medium">
					{record.kind === "work"
						? t("payroll.days.panel.work", "Work")
						: record.isPaid
							? t("payroll.days.panel.paidBreak", "Paid break")
							: t("payroll.days.panel.break", "Break")}
				</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{localTime(record.start, date, format)} –{" "}
					{record.end
						? localTime(record.end, date, format)
						: t("payroll.days.panel.running", "running")}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{record.approvalState !== "approved" ? (
					<Badge variant="outline">
						{record.approvalState === "pending"
							? t("payroll.days.panel.pending", "Pending")
							: t("payroll.days.panel.draft", "Draft")}
					</Badge>
				) : null}
				{record.durationMinutes !== null ? (
					<span className="text-muted-foreground text-xs tabular-nums">
						{t("payroll.days.panel.minutes", "{minutes} min", { minutes: record.durationMinutes })}
					</span>
				) : null}
			</div>
		</li>
	);
}

/** `HH:mm` of a local `YYYY-MM-DDTHH:mm`, with its date when it is not the panel's day. */
function localTime(value: string, date: string, format: PayrollDaysFormat): string {
	const [valueDate = date, time = ""] = value.split("T");
	return valueDate === date ? time : `${format.shortDate(valueDate)} ${time}`;
}
