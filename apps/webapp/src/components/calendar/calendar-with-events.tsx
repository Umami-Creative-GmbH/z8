"use client";

import type * as React from "react";
import type { DayButton } from "react-day-picker";
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
	const eventColors = events
		.map((event) => event.color)
		.filter((color, index, self) => self.indexOf(color) === index)
		.slice(0, 3);

	return (
		<div className="relative w-full h-full">
			<CalendarDayButton day={day} {...props} />
			{eventColors.length > 0 && (
				<div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
					{eventColors.map((color, index) => (
						<div key={index} className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
					))}
				</div>
			)}
		</div>
	);
}
