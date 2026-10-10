"use client";

import { IconChevronRight, IconClock, IconMapPin } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { type TouchEvent, useEffect, useRef } from "react";
import type { ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { Badge } from "@/components/ui/badge";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { shiftEndsNextDay, shiftPlaceLabel } from "@/lib/scheduling/shift-labels";
import { cn } from "@/lib/utils";
import { groupShiftsByDay } from "./employee-schedule-utils";

/** A horizontal swipe at least this long (px) moves a week. */
const SWIPE_DISTANCE = 60;

interface EmployeeShiftAgendaProps {
	days: PlainDate[];
	shifts: ShiftWithRelations[];
	loading: boolean;
	/** Today in the organization's zone. */
	today: PlainDate;
	/** The day the schedule was opened for (YYYY-MM-DD), scrolled into view. */
	focusDate: string | null;
	organizationTimezone: string;
	onSelectShift: (shift: ShiftWithRelations) => void;
	onPreviousWeek: () => void;
	onNextWeek: () => void;
}

/** The phone view of an employee's week: one row per day, its shifts underneath. */
export function EmployeeShiftAgenda({
	days,
	shifts,
	loading,
	today,
	focusDate,
	organizationTimezone,
	onSelectShift,
	onPreviousWeek,
	onNextWeek,
}: EmployeeShiftAgendaProps) {
	const { t } = useTranslate();
	const locale = useTolgee().getLanguage() || "en";
	const touchStart = useRef<{ x: number; y: number } | null>(null);
	const focusedDay = useRef<HTMLLIElement>(null);

	useEffect(() => {
		focusedDay.current?.scrollIntoView({ block: "start" });
	}, []);

	const handleTouchStart = (event: TouchEvent) => {
		const touch = event.touches[0];
		touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
	};

	const handleTouchEnd = (event: TouchEvent) => {
		const start = touchStart.current;
		const touch = event.changedTouches[0];
		touchStart.current = null;
		if (!start || !touch) return;
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;
		if (dx < 0) onNextWeek();
		else onPreviousWeek();
	};

	return (
		<div className="space-y-2">
			{loading && (
				<p
					className="animate-pulse text-muted-foreground text-sm motion-reduce:animate-none"
					role="status"
				>
					{t("scheduling:scheduling.scheduler.loading", "Loading schedule...")}
				</p>
			)}
			<ul
				className="touch-pan-y space-y-2"
				onTouchStart={handleTouchStart}
				onTouchEnd={handleTouchEnd}
			>
				{groupShiftsByDay(shifts, days, organizationTimezone).map((day) => {
					const dayKey = day.date.toString();
					const isToday = day.date.equals(today);
					return (
						<li
							key={dayKey}
							ref={dayKey === focusDate ? focusedDay : undefined}
							aria-current={isToday ? "date" : undefined}
							className={cn(
								"scroll-mt-4 rounded-xl border p-3",
								isToday && "border-primary/40",
								dayKey === focusDate && "ring-2 ring-primary/30",
							)}
						>
							<div className="flex items-center gap-2">
								<span className="font-medium text-sm">
									{formatPlainDate(day.date, locale, "weekdayMonthDay")}
								</span>
								{isToday && (
									<Badge variant="secondary" className="text-xs">
										{t("scheduling:scheduling.mySchedule.today", "Today")}
									</Badge>
								)}
							</div>
							{day.shifts.length === 0 ? (
								!loading && (
									<p className="mt-1 text-muted-foreground text-xs">
										{t("scheduling:scheduling.mySchedule.noShifts", "No shifts")}
									</p>
								)
							) : (
								<div className="mt-2 space-y-2">
									{day.shifts.map((shift) => (
										<AgendaShift key={shift.id} shift={shift} onSelect={onSelectShift} />
									))}
								</div>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function AgendaShift({
	shift,
	onSelect,
}: {
	shift: ShiftWithRelations;
	onSelect: (shift: ShiftWithRelations) => void;
}) {
	const { t } = useTranslate();
	const place = shiftPlaceLabel(shift.subarea?.location.name, shift.subarea?.name);

	return (
		<button
			type="button"
			onClick={() => onSelect(shift)}
			className="flex min-h-11 w-full items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5 text-sm">
					<IconClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span className="font-medium tabular-nums">
						{shift.startTime} – {shift.endTime}
					</span>
					{shiftEndsNextDay(shift) && (
						<span className="text-muted-foreground text-xs">
							({t("scheduling:scheduling.shiftDetails.endsNextDay", "ends next day")})
						</span>
					)}
				</div>
				{place && (
					<div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
						<IconMapPin className="size-3 shrink-0" aria-hidden="true" />
						<span className="truncate">{place}</span>
					</div>
				)}
			</div>
			<IconChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		</button>
	);
}
