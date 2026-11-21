"use client";

import { usePayrollRows } from "./use-payroll-rows";
import { Temporal } from "temporal-polyfill";
import { absenceSwatchStyle } from "./payroll-absence-style";
import type { PayrollPeriodDayAbsence, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { cn } from "@/lib/utils";
import type { PayrollDaysFormat } from "./payroll-day-format";
import type { PayrollTranslate } from "./state";

const EMPLOYEE_COLUMN = "11rem";
const DAY_COLUMN = "2rem";
/** h-7 cells plus the row border. */
const ROW_HEIGHT = 29;

function isWeekend(date: string): boolean {
	return Temporal.PlainDate.from(date).dayOfWeek >= 6;
}

/**
 * The period's absences as employees against days. Each day cell has a morning (left)
 * and an afternoon (right) half, so half days never read as full days. The calendar
 * scrolls inside its own frame, keeping the employee column and the date header fixed,
 * and only the rows in view are rendered, as in the Days grid.
 */
export function PayrollAbsenceCalendar({
	dates,
	employees,
	format,
	t,
}: {
	dates: readonly string[];
	employees: readonly PayrollPeriodEmployee[];
	format: PayrollDaysFormat;
	t: PayrollTranslate;
}) {
	const { scrollRef, start, end } = usePayrollRows(employees.length, ROW_HEIGHT, 12);
	const gridTemplateColumns = `${EMPLOYEE_COLUMN} repeat(${dates.length}, ${DAY_COLUMN})`;
	return (
		<div
			ref={scrollRef}
			className="relative max-h-[60vh] overflow-auto rounded-lg border bg-background"
		>
			<table
				className="block w-max min-w-full"
				aria-label={t("payroll.absences.calendarLabel", "Absences per employee and day")}
				aria-rowcount={employees.length + 1}
				aria-colcount={dates.length + 1}
			>
				<thead className="sticky top-0 z-20 block min-w-max">
					<tr
						aria-rowindex={1}
						className="grid border-b bg-muted text-muted-foreground text-[0.6875rem]"
						style={{ gridTemplateColumns }}
					>
						<th
							scope="col"
							className="sticky left-0 z-10 flex items-end border-r bg-muted px-3 py-1.5 font-medium text-xs"
						>
							{t("payroll.days.employee", "Employee")}
						</th>
						{dates.map((date) => (
							<th
								key={date}
								scope="col"
								className={cn(
									"flex flex-col items-center justify-end py-1.5 tabular-nums",
									isWeekend(date) && "bg-muted-foreground/10",
								)}
							>
								<span>{format.weekday(date)}</span>
								<span className="font-medium text-foreground">{format.dayOfMonth(date)}</span>
							</th>
						))}
					</tr>
				</thead>
				<tbody
					className="relative block min-w-max"
					style={{ height: employees.length * ROW_HEIGHT }}
				>
					{employees.slice(start, end).map((employee, offset) => {
						const index = start + offset;
						return (
							<tr
								key={employee.id}
								aria-rowindex={index + 2}
								className="absolute top-0 left-0 grid w-full border-b"
								style={{
									gridTemplateColumns,
									height: ROW_HEIGHT,
									transform: `translateY(${index * ROW_HEIGHT}px)`,
								}}
							>
								<th
									scope="row"
									className="sticky left-0 z-10 flex min-w-0 items-center border-r bg-background px-3 py-1"
								>
									<span className="truncate text-xs font-medium">{employee.name}</span>
								</th>
								{employee.days.map((day) => (
									<PayrollAbsenceCalendarCell
										key={day.date}
										absences={day.absences}
										date={day.date}
										employeeName={employee.name}
										format={format}
										t={t}
									/>
								))}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function PayrollAbsenceCalendarCell({
	absences,
	date,
	employeeName,
	format,
	t,
}: {
	absences: readonly PayrollPeriodDayAbsence[];
	date: string;
	employeeName: string;
	format: PayrollDaysFormat;
	t: PayrollTranslate;
}) {
	const morning = absences.find(
		(absence) => absence.period === "full_day" || absence.period === "am",
	);
	const afternoon = absences.find(
		(absence) => absence.period === "full_day" || absence.period === "pm",
	);
	const partial = absences.find((absence) => absence.period === "partial_day");
	const description =
		absences.length === 0
			? undefined
			: [
					`${employeeName}, ${format.weekday(date)} ${format.dayOfMonth(date)}`,
					...absences.map((absence) => payrollAbsenceMarkLabel(absence, t)),
				].join("\n");

	return (
		<td
			title={description}
			aria-label={description}
			className={cn("relative flex h-7 gap-px p-0.5", isWeekend(date) && "bg-muted/50")}
		>
			<AbsenceHalf absence={morning} side="am" />
			<AbsenceHalf absence={afternoon} side="pm" />
			{partial && !morning && !afternoon ? (
				<span
					aria-hidden="true"
					className={cn(
						"absolute inset-x-0.5 bottom-0.5 h-2 rounded-sm",
						partial.approvalState === "pending" && "outline outline-1 outline-dashed",
					)}
					style={absenceSwatchStyle(partial)}
				/>
			) : null}
		</td>
	);
}

function AbsenceHalf({
	absence,
	side,
}: {
	absence: PayrollPeriodDayAbsence | undefined;
	side: "am" | "pm";
}) {
	if (!absence) return <span aria-hidden="true" className="flex-1" />;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex-1",
				side === "am" ? "rounded-l-sm" : "rounded-r-sm",
				absence.approvalState === "pending" && "outline outline-1 outline-dashed -outline-offset-1",
			)}
			style={absenceSwatchStyle(absence)}
		/>
	);
}

function payrollAbsenceMarkLabel(absence: PayrollPeriodDayAbsence, t: PayrollTranslate): string {
	const half =
		absence.period === "am"
			? t("payroll.days.cell.am", "AM")
			: absence.period === "pm"
				? t("payroll.days.cell.pm", "PM")
				: absence.period === "partial_day"
					? t("payroll.days.cell.partialDay", "Part of the day")
					: null;
	return [
		absence.categoryName,
		half,
		absence.approvalState === "pending" ? t("payroll.absences.pending", "Pending") : null,
	]
		.filter(Boolean)
		.join(" · ");
}
