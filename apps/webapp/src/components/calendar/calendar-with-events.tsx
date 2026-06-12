"use client";

import type { DayButton } from "@daypicker/react";
import type * as React from "react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import type { CalendarEvent } from "@/lib/calendar/types";

interface CalendarWithEventsProps {
	selected: Date | undefined;
	onSelect: (date: Date | undefined) => void;
	month: Date;
	onMonthChange: (date: Date) => void;
	eventsByDate: Map<string, CalendarEvent[]>;
}

export function CalendarWithEvents({
	selected,
	onSelect,
	month,
	onMonthChange,
	eventsByDate,
}: CalendarWithEventsProps) {
	return (
		<Calendar
			mode="single"
			selected={selected}
			onSelect={onSelect}
			month={month}
			onMonthChange={onMonthChange}
			captionLayout="dropdown"
			components={{
				DayButton: (props) => <DayButtonWithEvents {...props} eventsByDate={eventsByDate} />,
			}}
			className="rounded-md border"
		/>
	);
}

function DayButtonWithEvents({
	day,
	eventsByDate,
	...props
}: React.ComponentProps<typeof DayButton> & {
	eventsByDate: Map<string, CalendarEvent[]>;
}) {
	const dateKey = day.date.toISOString().split("T")[0];
	const events = eventsByDate.get(dateKey) || [];

	// Get unique colors for this day's events (max 3 shown)
	const eventColors: string[] = [];
	const eventColorSet = new Set<string>();
	for (const event of events) {
		if (!eventColorSet.has(event.color)) {
			eventColorSet.add(event.color);
			eventColors.push(event.color);
		}
		if (eventColors.length === 3) {
			break;
		}
	}

	return (
		<div className="relative size-full">
			<CalendarDayButton day={day} {...props} />
			{eventColors.length > 0 && (
				<div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
					{eventColors.map((color) => (
						<div key={color} className="size-1 rounded-full" style={{ backgroundColor: color }} />
					))}
				</div>
			)}
		</div>
	);
}
