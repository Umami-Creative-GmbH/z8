"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { cn } from "@/lib/utils";
import { DifferenceValue, PayrollLeftOn, PayrollSettlementMarker } from "./payroll-days-grid";
import {
	isAfterDeparture,
	type PayrollDaysFormat,
	absencePeriodLabel,
	dayTitle,
} from "./payroll-day-format";
import type { PayrollTranslate } from "./state";

/**
 * The Days tab below the mobile breakpoint (#1894): one employee at a time, their days
 * as a list, with a picker and previous/next buttons to switch employees. Nothing in it
 * is wider than the screen.
 */
export function PayrollDaysList({
	employees,
	format,
	onSelectDay,
	t,
}: {
	employees: readonly PayrollPeriodEmployee[];
	format: PayrollDaysFormat;
	onSelectDay: (employee: PayrollPeriodEmployee, day: PayrollPeriodDay) => void;
	t: PayrollTranslate;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const index = Math.max(
		0,
		employees.findIndex((employee) => employee.id === selectedId),
	);
	const employee = employees[index];
	if (!employee) return null;
	const select = (next: number) => setSelectedId(employees[next]?.id ?? null);

	return (
		<div className="flex min-w-0 flex-col gap-3">
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="icon"
					disabled={index === 0}
					onClick={() => select(index - 1)}
					aria-label={t("payroll.days.list.previousEmployee", "Previous employee")}
				>
					<IconChevronLeft aria-hidden="true" />
				</Button>
				<Select value={employee.id} onValueChange={(value) => setSelectedId(value)}>
					<SelectTrigger
						className="min-w-0 flex-1"
						aria-label={t("payroll.days.list.employee", "Employee")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{employees.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="outline"
					size="icon"
					disabled={index === employees.length - 1}
					onClick={() => select(index + 1)}
					aria-label={t("payroll.days.list.nextEmployee", "Next employee")}
				>
					<IconChevronRight aria-hidden="true" />
				</Button>
			</div>

			<div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
				<span className="truncate text-muted-foreground text-xs">
					{[employee.employeeNumber, employee.teamName].filter(Boolean).join(" · ")}
				</span>
				<PayrollLeftOn employee={employee} format={format} t={t} />
				<span className="tabular-nums">
					{t("payroll.days.list.total", "Total {hours} h", {
						hours: format.hours(employee.totals.creditedMinutes),
					})}
					{employee.totals.requiredMinutes !== null ? (
						<span className="text-muted-foreground">
							{" "}
							/ {format.hours(employee.totals.requiredMinutes)}{" "}
							<DifferenceValue minutes={employee.totals.differenceMinutes ?? 0} format={format} />
						</span>
					) : null}
				</span>
			</div>

			<ul
				className="flex flex-col divide-y rounded-lg border bg-background"
				aria-label={t("payroll.days.list.label", "Days of {name}", { name: employee.name })}
			>
				{employee.days.map((day) => {
					const afterDeparture = isAfterDeparture(employee, day.date);
					return (
						<li key={day.date}>
							<button
								type="button"
								aria-label={dayTitle(day, format, t, afterDeparture)}
								onClick={() => onSelectDay(employee, day)}
								className={cn(
									"flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
									afterDeparture && "bg-muted text-muted-foreground",
								)}
							>
								<span className="w-14 shrink-0">
									<span className="block text-muted-foreground text-xs">
										{format.weekday(day.date)}
									</span>
									<span className="font-medium">{format.shortDate(day.date)}</span>
								</span>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-xs">
										{[
											...day.absences.map((absence) =>
												[
													absence.categoryName,
													absencePeriodLabel(absence.period, t),
													absence.approvalState === "pending"
														? t("payroll.days.cell.pending", "pending")
														: null,
												]
													.filter(Boolean)
													.join(" · "),
											),
											day.holiday?.name,
										]
											.filter(Boolean)
											.join(", ")}
									</span>
								</span>
								<span className="flex shrink-0 flex-col items-end">
									<span className="flex items-center gap-1 font-medium">
										<PayrollSettlementMarker day={day} />
										{day.creditedMinutes === 0 ? "–" : format.hours(day.creditedMinutes)}
									</span>
									{day.requiredMinutes !== null && day.requiredMinutes > 0 ? (
										<span className="text-muted-foreground text-xs">
											/ {format.hours(day.requiredMinutes)}{" "}
											<DifferenceValue minutes={day.differenceMinutes ?? 0} format={format} />
										</span>
									) : null}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
