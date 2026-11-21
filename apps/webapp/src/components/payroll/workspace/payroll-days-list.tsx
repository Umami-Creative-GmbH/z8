"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useId, useState } from "react";
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
import {
	DifferenceValue,
	dayButtonPicking,
	type PayrollDayPicking,
	PayrollLeftOn,
	PayrollSettlementMarker,
} from "./payroll-days-grid";
import {
	isAfterDeparture,
	type PayrollDaysFormat,
	absencePeriodLabel,
	dayTitle,
} from "./payroll-day-format";
import { groupSelectionState, payrollDayKey, settleableGroup } from "./payroll-day-selection";
import { daysWithEntries } from "./payroll-empty-days";
import type { PayrollTranslate } from "./state";

/**
 * The Days tab below the mobile breakpoint (#1894): one employee at a time, their days
 * as a list, with a picker and previous/next buttons to switch employees. Nothing in it
 * is wider than the screen.
 */
export function PayrollDaysList({
	employees,
	format,
	hideEmptyDays = false,
	onSelectDay,
	picking,
	t,
}: {
	employees: readonly PayrollPeriodEmployee[];
	format: PayrollDaysFormat;
	/** Lists only the employee's days with entries or a change since settled. */
	hideEmptyDays?: boolean;
	onSelectDay: (employee: PayrollPeriodEmployee, day: PayrollPeriodDay) => void;
	/** Set while days are picked to settle: a day toggles instead of opening its panel. */
	picking?: PayrollDayPicking;
	t: PayrollTranslate;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const nothingToSettleId = useId();
	const index = Math.max(
		0,
		employees.findIndex((employee) => employee.id === selectedId),
	);
	const employee = employees[index];
	if (!employee) return null;
	const select = (next: number) => setSelectedId(employees[next]?.id ?? null);
	const pickableDays = picking ? settleableGroup(picking.groups.byEmployee, employee.id) : [];
	const days = hideEmptyDays ? daysWithEntries(employee.days) : employee.days;

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

			{picking ? (
				<div className="flex flex-col gap-1">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						aria-pressed={groupSelectionState(picking.selected, pickableDays) === "all"}
						aria-describedby={pickableDays.length === 0 ? nothingToSettleId : undefined}
						disabled={pickableDays.length === 0}
						onClick={() => picking.onToggleEmployee(employee)}
					>
						{t("payroll.days.select.employee", "Select every day of {name} to settle", {
							name: employee.name,
						})}
					</Button>
					{pickableDays.length === 0 ? (
						<p id={nothingToSettleId} className="text-muted-foreground text-xs">
							{t(
								"payroll.days.select.employeeNothingToSettle",
								"{name} has no unsettled days with entries in this period.",
								{ name: employee.name },
							)}
						</p>
					) : null}
				</div>
			) : null}

			{days.length === 0 ? (
				<p className="rounded-lg border bg-background px-3 py-4 text-center text-muted-foreground text-sm">
					{t("payroll.days.list.noEntries", "{name} has no days with entries in this period.", {
						name: employee.name,
					})}
				</p>
			) : (
				<ul
					className="flex flex-col divide-y rounded-lg border bg-background"
					aria-label={t("payroll.days.list.label", "Days of {name}", { name: employee.name })}
				>
					{days.map((day) => {
						const afterDeparture = isAfterDeparture(employee, day.date);
						const { className: pickingClassName, ...pickingProps } = dayButtonPicking(
							day,
							dayTitle(day, format, t, afterDeparture),
							picking !== undefined,
							picking?.selected.has(payrollDayKey(employee.id, day.date)),
							t,
						);
						return (
							<li key={day.date}>
								<button
									type="button"
									aria-pressed={pickingProps["aria-pressed"]}
									aria-disabled={pickingProps["aria-disabled"]}
									aria-label={pickingProps.title}
									onClick={() => {
										if (!picking) onSelectDay(employee, day);
										else if (!pickingProps["aria-disabled"])
											picking.onToggleDay(employee, day, false);
									}}
									className={cn(
										"flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
										afterDeparture && "bg-muted text-muted-foreground",
										pickingClassName,
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
			)}
		</div>
	);
}
