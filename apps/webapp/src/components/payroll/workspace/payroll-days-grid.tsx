"use client";

import { IconAlertCircle, IconCircleCheck, IconConfetti } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Temporal } from "temporal-polyfill";
import { absenceCategoryColor } from "@/components/absences/category-badge";
import type {
	PayrollPeriodDay,
	PayrollPeriodDayAbsence,
	PayrollPeriodEmployee,
} from "@/lib/payroll-period/types";
import { cn } from "@/lib/utils";
import type { PayrollTranslate } from "./state";

const ROW_HEIGHT = 64;
const EMPLOYEE_COLUMN = "13rem";
const DAY_COLUMN = "4.75rem";
const TOTAL_COLUMN = "6.5rem";

export interface PayrollDaysFormat {
	hours: (minutes: number) => string;
	difference: (minutes: number) => string;
	weekday: (date: string) => string;
	dayOfMonth: (date: string) => string;
	/** For example "Tuesday, 10 November 2026". */
	longDate: (date: string) => string;
	/** For example "10 Nov". */
	shortDate: (date: string) => string;
}

export function payrollDaysFormat(locale: string): PayrollDaysFormat {
	const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	const difference = new Intl.NumberFormat(locale, {
		maximumFractionDigits: 2,
		signDisplay: "exceptZero",
	});
	const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
	const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
	const longDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
	const shortDate = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});
	// A calendar date shown as itself: formatted at UTC midnight in UTC, never the viewer's zone.
	const asDate = (date: string) => new Date(`${date}T00:00:00Z`);
	return {
		hours: (minutes) => hours.format(minutes / 60),
		difference: (minutes) => difference.format(minutes / 60),
		weekday: (date) => weekday.format(asDate(date)),
		dayOfMonth: (date) => day.format(asDate(date)),
		longDate: (date) => longDate.format(asDate(date)),
		shortDate: (date) => shortDate.format(asDate(date)),
	};
}

/** Whether the day lies after the last working day of an employee who left (#1894). */
export function isAfterDeparture(employee: PayrollPeriodEmployee, date: string): boolean {
	return employee.departure ? date > employee.departure.lastWorkingDay : false;
}

function isWeekend(date: string): boolean {
	return Temporal.PlainDate.from(date).dayOfWeek >= 6;
}

/**
 * Employees against the period's days. The employee column and the date header stay
 * fixed while the grid scrolls, and only the rows in view are rendered.
 */
export function PayrollDaysGrid({
	dates,
	employees,
	format,
	onSelectDay,
	t,
}: {
	dates: readonly string[];
	employees: readonly PayrollPeriodEmployee[];
	format: PayrollDaysFormat;
	/** Opens the day's side panel (#1894). */
	onSelectDay: (employee: PayrollPeriodEmployee, day: PayrollPeriodDay) => void;
	t: PayrollTranslate;
}) {
	// The virtualizer changes its rows in place, so the compiler must not memoize this component.
	"use no memo";
	const scrollRef = useRef<HTMLDivElement | null>(null);
	// oxlint-disable-next-line react/incompatible-library -- memoization is opted out above
	const virtualizer = useVirtualizer({
		count: employees.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 8,
	});
	const gridTemplateColumns = `${EMPLOYEE_COLUMN} repeat(${dates.length}, ${DAY_COLUMN}) ${TOTAL_COLUMN}`;

	return (
		<div
			ref={scrollRef}
			className="relative max-h-[70vh] overflow-auto rounded-lg border bg-background"
			role="table"
			aria-label={t("payroll.days.gridLabel", "Hours per employee and day")}
			aria-rowcount={employees.length + 1}
			aria-colcount={dates.length + 2}
		>
			<div role="rowgroup" className="sticky top-0 z-20 min-w-max">
				<div
					role="row"
					aria-rowindex={1}
					className="grid border-b bg-muted text-muted-foreground text-xs"
					style={{ gridTemplateColumns }}
				>
					<div
						role="columnheader"
						className="sticky left-0 z-10 flex items-end border-r bg-muted px-3 py-2 font-medium"
					>
						{t("payroll.days.employee", "Employee")}
					</div>
					{dates.map((date) => (
						<div
							key={date}
							role="columnheader"
							className={cn(
								"flex flex-col items-center justify-end px-1 py-2 tabular-nums",
								isWeekend(date) && "bg-muted-foreground/10",
							)}
						>
							<span>{format.weekday(date)}</span>
							<span className="font-medium text-foreground">{format.dayOfMonth(date)}</span>
						</div>
					))}
					<div
						role="columnheader"
						className="flex items-end justify-end border-l px-3 py-2 font-medium"
					>
						{t("payroll.days.total", "Total")}
					</div>
				</div>
			</div>
			<div
				role="rowgroup"
				className="relative min-w-max"
				style={{ height: virtualizer.getTotalSize() }}
			>
				{virtualizer.getVirtualItems().map((item) => {
					const employee = employees[item.index];
					if (!employee) return null;
					return (
						<div
							key={employee.id}
							role="row"
							aria-rowindex={item.index + 2}
							className="absolute top-0 left-0 grid w-full border-b"
							style={{
								gridTemplateColumns,
								height: item.size,
								transform: `translateY(${item.start}px)`,
							}}
						>
							<div
								role="rowheader"
								className="sticky left-0 z-10 flex min-w-0 flex-col justify-center border-r bg-background px-3"
							>
								<span className="truncate font-medium text-sm">{employee.name}</span>
								<span className="truncate text-muted-foreground text-xs">
									{[employee.employeeNumber, employee.teamName].filter(Boolean).join(" · ")}
								</span>
								<PayrollLeftOn employee={employee} format={format} t={t} />
							</div>
							{employee.days.map((day) => (
								<PayrollDayCell
									key={day.date}
									afterDeparture={isAfterDeparture(employee, day.date)}
									day={day}
									format={format}
									onSelect={() => onSelectDay(employee, day)}
									t={t}
								/>
							))}
							<PayrollTotalCell employee={employee} format={format} t={t} />
						</div>
					);
				})}
			</div>
		</div>
	);
}

/** "Left on …" for an employee who left (#1894). */
export function PayrollLeftOn({
	employee,
	format,
	t,
}: {
	employee: PayrollPeriodEmployee;
	format: PayrollDaysFormat;
	t: PayrollTranslate;
}) {
	if (!employee.departure) return null;
	return (
		<span className="truncate text-amber-700 text-xs dark:text-amber-400">
			{t("payroll.days.leftOn", "Left on {date}", {
				date: format.shortDate(employee.departure.lastWorkingDay),
			})}
		</span>
	);
}

function PayrollDayCell({
	afterDeparture,
	day,
	format,
	onSelect,
	t,
}: {
	afterDeparture: boolean;
	day: PayrollPeriodDay;
	format: PayrollDaysFormat;
	onSelect: () => void;
	t: PayrollTranslate;
}) {
	const pending = day.absences.some((absence) => absence.approvalState === "pending");
	const description = dayTitle(day, format, t, afterDeparture);
	return (
		<div role="cell" className="min-w-0">
			<button
				type="button"
				title={description}
				aria-label={description}
				onClick={onSelect}
				className={cn(
					"flex h-full w-full min-w-0 flex-col justify-between gap-0.5 px-1.5 py-1 text-left text-xs tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
					isWeekend(day.date) && "bg-muted/50",
					afterDeparture && "bg-muted text-muted-foreground",
				)}
				style={
					pending
						? {
								backgroundImage:
									"repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in oklab, currentColor 10%, transparent) 5px 7px)",
							}
						: undefined
				}
			>
				<PayrollDayCellContent day={day} format={format} />
			</button>
		</div>
	);
}

/** The worked hours, required hours, difference, holiday and absence markers of one day. */
function PayrollDayCellContent({
	day,
	format,
}: {
	day: PayrollPeriodDay;
	format: PayrollDaysFormat;
}) {
	return (
		<>
			<div className="flex items-center justify-between gap-1">
				<span className={cn("font-medium", day.creditedMinutes === 0 && "text-muted-foreground")}>
					{day.creditedMinutes === 0 ? "–" : format.hours(day.creditedMinutes)}
				</span>
				<span className="flex shrink-0 items-center gap-0.5">
					<PayrollSettlementMarker day={day} />
					{day.holiday ? (
						<IconConfetti aria-hidden="true" className="size-3.5 text-amber-600" />
					) : null}
				</span>
			</div>
			{day.requiredMinutes !== null && day.requiredMinutes > 0 ? (
				<div className="flex items-center justify-between gap-1 text-[0.6875rem] text-muted-foreground">
					<span>/ {format.hours(day.requiredMinutes)}</span>
					<DifferenceValue minutes={day.differenceMinutes ?? 0} format={format} />
				</div>
			) : null}
			<div className="flex min-h-1.5 gap-0.5">
				{day.absences.map((absence) => (
					<AbsenceMarker key={absence.absenceId} absence={absence} />
				))}
			</div>
		</>
	);
}

/** A settled day's check, or the warning of a day changed since settled (#1897). */
export function PayrollSettlementMarker({ day }: { day: PayrollPeriodDay }) {
	if (day.settlement?.state === "settled") {
		return (
			<IconCircleCheck
				aria-hidden="true"
				data-settled=""
				className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
			/>
		);
	}
	if (day.settlement?.state === "changed_since_settled") {
		return (
			<IconAlertCircle
				aria-hidden="true"
				data-changed-since-settled=""
				className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
			/>
		);
	}
	return null;
}

function AbsenceMarker({ absence }: { absence: PayrollPeriodDayAbsence }) {
	const color = absenceCategoryColor(absence.categoryType, absence.categoryColor);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex h-1.5 flex-1 overflow-hidden rounded-full",
				absence.period === "pm" && "justify-end",
			)}
		>
			<span
				className={cn(
					"h-full rounded-full",
					absence.period === "full_day" ? "w-full" : "w-1/2",
					absence.approvalState === "pending" && "opacity-60",
				)}
				style={{ backgroundColor: color }}
			/>
		</span>
	);
}

export function DifferenceValue({
	minutes,
	format,
}: {
	minutes: number;
	format: PayrollDaysFormat;
}) {
	return (
		<span
			className={cn(
				minutes > 0 && "text-emerald-700 dark:text-emerald-400",
				minutes < 0 && "text-rose-700 dark:text-rose-400",
			)}
		>
			{format.difference(minutes)}
		</span>
	);
}

function PayrollTotalCell({
	employee,
	format,
	t,
}: {
	employee: PayrollPeriodEmployee;
	format: PayrollDaysFormat;
	t: PayrollTranslate;
}) {
	const { totals } = employee;
	return (
		<div
			role="cell"
			className="flex flex-col items-end justify-center gap-0.5 border-l bg-muted/30 px-3 text-xs tabular-nums"
		>
			<span className="font-semibold text-sm">{format.hours(totals.creditedMinutes)}</span>
			{totals.requiredMinutes !== null ? (
				<span className="text-muted-foreground">
					/ {format.hours(totals.requiredMinutes)}{" "}
					<DifferenceValue minutes={totals.differenceMinutes ?? 0} format={format} />
				</span>
			) : null}
			{totals.absenceDays > 0 ? (
				<span className="text-muted-foreground">
					{t("payroll.days.absenceDays", "{count} absence days", { count: totals.absenceDays })}
				</span>
			) : null}
		</div>
	);
}

/** The cell's full meaning as text, for the tooltip and assistive technology. */
export function dayTitle(
	day: PayrollPeriodDay,
	format: PayrollDaysFormat,
	t: PayrollTranslate,
	afterDeparture = false,
): string {
	const parts = [
		format.longDate(day.date),
		t("payroll.days.cell.worked", "Worked {hours} h", { hours: format.hours(day.creditedMinutes) }),
	];
	if (afterDeparture) {
		parts.push(t("payroll.days.cell.afterDeparture", "After the last working day"));
	}
	if (day.requiredMinutes !== null) {
		parts.push(
			t("payroll.days.cell.required", "Required {hours} h", {
				hours: format.hours(day.requiredMinutes),
			}),
			t("payroll.days.cell.difference", "Difference {hours} h", {
				hours: format.difference(day.differenceMinutes ?? 0),
			}),
		);
	}
	for (const absence of day.absences) {
		parts.push(
			[
				absence.categoryName,
				absencePeriodLabel(absence.period, t),
				absence.approvalState === "pending" ? t("payroll.days.cell.pending", "pending") : null,
			]
				.filter(Boolean)
				.join(" · "),
		);
	}
	if (day.holiday) {
		parts.push(t("payroll.days.cell.holiday", "Holiday: {name}", { name: day.holiday.name }));
	}
	if (day.settlement?.state === "settled") {
		parts.push(t("payroll.days.cell.settled", "Settled"));
	}
	if (day.settlement?.state === "changed_since_settled") {
		parts.push(settledChangeText(day.settlement.change, format, t));
	}
	return parts.join("\n");
}

/** "Changed since settled: +1.5 h, absence changed" (#1897). */
export function settledChangeText(
	change: { creditedMinutesDifference: number; absencesChanged: boolean },
	format: Pick<PayrollDaysFormat, "difference">,
	t: PayrollTranslate,
): string {
	const details = [
		change.creditedMinutesDifference !== 0
			? t("payroll.days.cell.changedHours", "{hours} h", {
					hours: format.difference(change.creditedMinutesDifference),
				})
			: null,
		change.absencesChanged ? t("payroll.days.cell.changedAbsence", "absence changed") : null,
	].filter(Boolean);
	return t("payroll.days.cell.changedSinceSettled", "Changed since settled: {details}", {
		details: details.join(", "),
	});
}

export function absencePeriodLabel(
	period: PayrollPeriodDayAbsence["period"],
	t: PayrollTranslate,
): string | null {
	switch (period) {
		case "am":
			return t("payroll.days.cell.am", "AM");
		case "pm":
			return t("payroll.days.cell.pm", "PM");
		case "partial_day":
			return t("payroll.days.cell.partialDay", "Part of the day");
		default:
			return null;
	}
}
