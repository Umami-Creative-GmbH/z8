"use client";

import { IconAlertCircle, IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type KeyboardEvent, useCallback, useMemo, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DAY_OF_WEEK_ORDER, distributeMinutesLargestRemainder } from "@/lib/contracts/custom-days";
import type { CustomWorkDay, DayOfWeek } from "@/lib/contracts/types";
import { cn } from "@/lib/utils";

const CLOCK_IN_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const GRID_COLUMN_COUNT = 4; // 0: isWorkDay, 1: hours, 2: minutes, 3: latestClockIn

/** Creates a normalized 7-day custom work schedule backed by integer minutes per day. */
export function createDefaultCustomDays(weeklyMinutes = 2400): CustomWorkDay[] {
	const safeWeekly = Math.max(0, Math.min(10080, Math.round(weeklyMinutes)));
	const perWeekday = distributeMinutesLargestRemainder(safeWeekly, [1, 1, 1, 1, 1]);
	return DAY_OF_WEEK_ORDER.map((dayOfWeek, index) => {
		const isWorkDay = index < 5;
		return {
			dayOfWeek,
			isWorkDay,
			minutesPerDay: isWorkDay ? (perWeekday[index] ?? 480) : 0,
			latestClockIn: null,
		};
	});
}

/** Ensures all 7 weekdays exist in Monday–Sunday order. */
export function normalizeCustomDaysGridValue(
	days: readonly CustomWorkDay[] | null | undefined,
): CustomWorkDay[] {
	if (!days || days.length === 0) {
		return createDefaultCustomDays();
	}
	const byDay = new Map(days.map((day) => [day.dayOfWeek, day]));
	return DAY_OF_WEEK_ORDER.map((dayOfWeek) => {
		const existing = byDay.get(dayOfWeek);
		if (existing) {
			return {
				dayOfWeek,
				isWorkDay: existing.isWorkDay,
				minutesPerDay: existing.isWorkDay
					? Math.max(0, Math.min(1440, Math.round(existing.minutesPerDay)))
					: 0,
				latestClockIn: existing.isWorkDay ? existing.latestClockIn || null : null,
			};
		}
		return {
			dayOfWeek,
			isWorkDay: false,
			minutesPerDay: 0,
			latestClockIn: null,
		};
	});
}

export function sumCustomWorkDayMinutes(days: readonly CustomWorkDay[]): number {
	return days.reduce((sum, day) => sum + (day.isWorkDay ? day.minutesPerDay : 0), 0);
}

export function formatMinutesCompact(minutes: number): string {
	const safe = Math.max(0, Math.round(minutes));
	const hours = Math.floor(safe / 60);
	const mins = safe % 60;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

export function validateCustomDaysGrid(days: readonly CustomWorkDay[]): string | null {
	let total = 0;
	for (const day of days) {
		if (day.isWorkDay) {
			if (
				!Number.isInteger(day.minutesPerDay) ||
				day.minutesPerDay <= 0 ||
				day.minutesPerDay > 1440
			) {
				return "invalid_day_minutes";
			}
			if (day.latestClockIn && !CLOCK_IN_REGEX.test(day.latestClockIn)) {
				return "invalid_clock_in";
			}
			total += day.minutesPerDay;
		}
	}
	if (total > 10080) {
		return "exceeds_weekly_max";
	}
	return null;
}

export interface CustomDaysGridProps {
	value: readonly CustomWorkDay[];
	onChange: (nextDays: CustomWorkDay[]) => void;
	disabled?: boolean;
	ariaLabel?: string;
	error?: string | null;
	className?: string;
}

/**
 * Shared keyboard-accessible ARIA custom-days grid (`role="grid"`) backed by integer
 * `minutesPerDay`, per-day `isWorkDay`, and optional `latestClockIn` (`HH:mm`).
 * Reused in Settings → Contracts (Defaults & Templates) and Employee Detail → Contract.
 */
export function CustomDaysGrid({
	value,
	onChange,
	disabled = false,
	ariaLabel,
	error = null,
	className,
}: CustomDaysGridProps) {
	const { t } = useTranslate();
	const rows = useMemo(() => normalizeCustomDaysGridValue(value), [value]);
	const cellRefs = useRef<Map<string, HTMLElement>>(new Map());

	const dayLabel = useCallback(
		(day: DayOfWeek): string => {
			switch (day) {
				case "monday":
					return t("settings.contracts.days.monday", "Monday");
				case "tuesday":
					return t("settings.contracts.days.tuesday", "Tuesday");
				case "wednesday":
					return t("settings.contracts.days.wednesday", "Wednesday");
				case "thursday":
					return t("settings.contracts.days.thursday", "Thursday");
				case "friday":
					return t("settings.contracts.days.friday", "Friday");
				case "saturday":
					return t("settings.contracts.days.saturday", "Saturday");
				case "sunday":
					return t("settings.contracts.days.sunday", "Sunday");
			}
		},
		[t],
	);

	const registerCell = useCallback(
		(rowIndex: number, colIndex: number) => (node: HTMLElement | null) => {
			const key = `${rowIndex}:${colIndex}`;
			if (node) cellRefs.current.set(key, node);
			else cellRefs.current.delete(key);
		},
		[],
	);

	const focusCell = useCallback((rowIndex: number, colIndex: number) => {
		const target = cellRefs.current.get(`${rowIndex}:${colIndex}`);
		if (target && !(target as HTMLInputElement).disabled) {
			target.focus();
			return true;
		}
		return false;
	}, []);

	const handleCellKeyDown = useCallback(
		(rowIndex: number, colIndex: number) => (event: KeyboardEvent<HTMLElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				for (let nextRow = rowIndex + 1; nextRow < rows.length; nextRow += 1) {
					if (focusCell(nextRow, colIndex) || focusCell(nextRow, 0)) break;
				}
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				for (let prevRow = rowIndex - 1; prevRow >= 0; prevRow -= 1) {
					if (focusCell(prevRow, colIndex) || focusCell(prevRow, 0)) break;
				}
				return;
			}
			if (event.key === "ArrowRight") {
				const target = event.currentTarget as HTMLInputElement;
				const atEnd =
					target.tagName !== "INPUT" ||
					target.type === "checkbox" ||
					target.type === "number" ||
					target.type === "time" ||
					target.selectionStart === target.value.length;
				if (!atEnd) return;
				for (let nextCol = colIndex + 1; nextCol < GRID_COLUMN_COUNT; nextCol += 1) {
					if (focusCell(rowIndex, nextCol)) {
						event.preventDefault();
						break;
					}
				}
				return;
			}
			if (event.key === "ArrowLeft") {
				const target = event.currentTarget as HTMLInputElement;
				const atStart =
					target.tagName !== "INPUT" ||
					target.type === "checkbox" ||
					target.type === "number" ||
					target.type === "time" ||
					target.selectionStart === 0;
				if (!atStart) return;
				for (let prevCol = colIndex - 1; prevCol >= 0; prevCol -= 1) {
					if (focusCell(rowIndex, prevCol)) {
						event.preventDefault();
						break;
					}
				}
				return;
			}
			if (event.key === "Home" && event.ctrlKey) {
				event.preventDefault();
				focusCell(0, 0);
				return;
			}
			if (event.key === "End" && event.ctrlKey) {
				event.preventDefault();
				focusCell(rows.length - 1, 0);
			}
		},
		[focusCell, rows.length],
	);

	const updateDay = useCallback(
		(dayOfWeek: DayOfWeek, updater: (current: CustomWorkDay) => CustomWorkDay) => {
			onChange(rows.map((day) => (day.dayOfWeek === dayOfWeek ? updater(day) : day)));
		},
		[onChange, rows],
	);

	const totalMinutes = useMemo(() => sumCustomWorkDayMinutes(rows), [rows]);
	const workDayCount = useMemo(() => rows.filter((d) => d.isWorkDay).length, [rows]);
	const validationCode = useMemo(() => validateCustomDaysGrid(rows), [rows]);

	const validationMessage = useMemo(() => {
		if (error) return error;
		switch (validationCode) {
			case "invalid_day_minutes":
				return t(
					"settings.contracts.customDays.errorInvalidMinutes",
					"Every active work day must have between 1 minute and 24 hours.",
				);
			case "invalid_clock_in":
				return t(
					"settings.contracts.customDays.errorInvalidClockIn",
					"Latest clock-in must use 24-hour HH:mm format.",
				);
			case "exceeds_weekly_max":
				return t(
					"settings.contracts.customDays.errorExceedsMax",
					"Weekly total cannot exceed 168 hours (10,080 minutes).",
				);
			default:
				return null;
		}
	}, [error, t, validationCode]);

	return (
		<div className={cn("space-y-2", className)}>
			<div className="overflow-x-auto rounded-lg border bg-card">
				<div
					role="grid"
					aria-label={
						ariaLabel ??
						t("settings.contracts.customDays.gridLabel", "Custom working days schedule")
					}
					aria-rowcount={rows.length + 1}
					aria-colcount={5}
					className="w-full min-w-[540px] divide-y text-sm"
				>
					<div
						role="row"
						aria-rowindex={1}
						className="grid grid-cols-[120px_96px_1fr_150px] items-center gap-3 bg-muted/40 px-3 py-2 font-medium text-muted-foreground text-xs"
					>
						<div role="columnheader" aria-colindex={1}>
							{t("settings.contracts.customDays.day", "Day")}
						</div>
						<div role="columnheader" aria-colindex={2}>
							{t("settings.contracts.customDays.workDay", "Work day")}
						</div>
						<div role="columnheader" aria-colindex={3}>
							{t("settings.contracts.customDays.duration", "Daily hours & minutes")}
						</div>
						<div role="columnheader" aria-colindex={4} className="flex items-center gap-1">
							<IconClock className="size-3.5" aria-hidden="true" />
							{t("settings.contracts.customDays.latestClockIn", "Latest clock-in")}
						</div>
					</div>

					{rows.map((day, rowIndex) => {
						const label = dayLabel(day.dayOfWeek);
						const hours = Math.floor(day.minutesPerDay / 60);
						const minutes = day.minutesPerDay % 60;
						const hasDayMinuteError =
							day.isWorkDay && (day.minutesPerDay <= 0 || day.minutesPerDay > 1440);

						return (
							<div
								key={day.dayOfWeek}
								role="row"
								aria-rowindex={rowIndex + 2}
								className={cn(
									"grid grid-cols-[120px_96px_1fr_150px] items-center gap-3 px-3 py-2 transition-colors",
									!day.isWorkDay && "bg-muted/20 text-muted-foreground",
								)}
							>
								<div role="rowheader" aria-colindex={1} className="font-medium">
									{label}
								</div>

								<div role="gridcell" aria-colindex={2} className="flex items-center">
									<Checkbox
										ref={registerCell(rowIndex, 0)}
										checked={day.isWorkDay}
										disabled={disabled}
										aria-label={t("settings.contracts.customDays.toggleWorkDay", "{day} work day", {
											day: label,
										})}
										onKeyDown={handleCellKeyDown(rowIndex, 0)}
										onCheckedChange={(checked) => {
											const active = checked === true;
											updateDay(day.dayOfWeek, (current) => ({
												...current,
												isWorkDay: active,
												minutesPerDay: active
													? current.minutesPerDay > 0
														? current.minutesPerDay
														: 480
													: 0,
												latestClockIn: active ? current.latestClockIn : null,
											}));
										}}
									/>
								</div>

								<div role="gridcell" aria-colindex={3} className="flex items-center gap-2">
									<div className="flex items-center gap-1">
										<Input
											ref={registerCell(rowIndex, 1)}
											type="number"
											inputMode="numeric"
											min={0}
											max={24}
											step={1}
											disabled={disabled || !day.isWorkDay}
											value={day.isWorkDay ? hours : 0}
											aria-label={t("settings.contracts.customDays.hoursAria", "{day} hours", {
												day: label,
											})}
											aria-invalid={hasDayMinuteError || undefined}
											onKeyDown={handleCellKeyDown(rowIndex, 1)}
											onChange={(event) => {
												const nextHours = Math.max(
													0,
													Math.min(24, Number.parseInt(event.target.value || "0", 10) || 0),
												);
												const nextMinutes = Math.min(
													1440,
													nextHours * 60 + (nextHours === 24 ? 0 : minutes),
												);
												updateDay(day.dayOfWeek, (current) => ({
													...current,
													minutesPerDay: nextMinutes,
												}));
											}}
											className="h-8 w-16 tabular-nums"
										/>
										<span className="text-muted-foreground text-xs">
											{t("settings.contracts.customDays.hoursUnit", "h")}
										</span>
									</div>
									<div className="flex items-center gap-1">
										<Input
											ref={registerCell(rowIndex, 2)}
											type="number"
											inputMode="numeric"
											min={0}
											max={59}
											step={5}
											disabled={disabled || !day.isWorkDay || hours >= 24}
											value={day.isWorkDay ? minutes : 0}
											aria-label={t("settings.contracts.customDays.minutesAria", "{day} minutes", {
												day: label,
											})}
											aria-invalid={hasDayMinuteError || undefined}
											onKeyDown={handleCellKeyDown(rowIndex, 2)}
											onChange={(event) => {
												const nextMins = Math.max(
													0,
													Math.min(59, Number.parseInt(event.target.value || "0", 10) || 0),
												);
												const nextTotal = Math.min(1440, hours * 60 + nextMins);
												updateDay(day.dayOfWeek, (current) => ({
													...current,
													minutesPerDay: nextTotal,
												}));
											}}
											className="h-8 w-16 tabular-nums"
										/>
										<span className="text-muted-foreground text-xs">
											{t("settings.contracts.customDays.minutesUnit", "m")}
										</span>
									</div>
									{day.isWorkDay && (
										<span className="text-muted-foreground text-xs tabular-nums">
											({day.minutesPerDay}m)
										</span>
									)}
								</div>

								<div role="gridcell" aria-colindex={4}>
									<Input
										ref={registerCell(rowIndex, 3)}
										type="time"
										disabled={disabled || !day.isWorkDay}
										value={day.isWorkDay ? (day.latestClockIn ?? "") : ""}
										aria-label={t(
											"settings.contracts.customDays.latestClockInAria",
											"{day} latest clock-in",
											{ day: label },
										)}
										onKeyDown={handleCellKeyDown(rowIndex, 3)}
										onChange={(event) => {
											const next = event.target.value.trim();
											updateDay(day.dayOfWeek, (current) => ({
												...current,
												latestClockIn: next ? next.slice(0, 5) : null,
											}));
										}}
										className="h-8 w-32 tabular-nums"
									/>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
				<span className="tabular-nums">
					{t(
						"settings.contracts.customDays.summary",
						"{workDays, plural, one {# work day} other {# work days}} · {total} ({minutes} min/week)",
						{
							workDays: workDayCount,
							total: formatMinutesCompact(totalMinutes),
							minutes: totalMinutes,
						},
					)}
				</span>
				<span>
					{t(
						"settings.contracts.customDays.keyboardHint",
						"Use arrow keys to move between days and columns.",
					)}
				</span>
			</div>

			{validationMessage && (
				<p role="alert" className="flex items-center gap-1.5 text-destructive text-xs">
					<IconAlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
					{validationMessage}
				</p>
			)}
		</div>
	);
}
