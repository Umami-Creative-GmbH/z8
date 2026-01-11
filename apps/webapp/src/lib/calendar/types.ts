export type CalendarEventType = "holiday" | "absence" | "time_entry" | "work_period" | "break";

export interface CalendarEvent {
	id: string;
	type: CalendarEventType;
	date: Date;
	endDate?: Date; // For multi-day events (absences, holidays)
	title: string;
	description?: string;
	color: string;
	metadata: Record<string, any>;
}

export interface HolidayEvent extends CalendarEvent {
	type: "holiday";
	metadata: {
		categoryName: string;
		categoryType: string;
		blocksTimeEntry: boolean;
		isRecurring: boolean;
	};
}

export interface AbsenceEvent extends CalendarEvent {
	type: "absence";
	metadata: {
		categoryName: string;
		status: "pending" | "approved" | "rejected";
		employeeName: string;
	};
}

export interface TimeEntryEvent extends CalendarEvent {
	type: "time_entry";
	metadata: {
		entryType: "clock_in" | "clock_out" | "correction";
		employeeName: string;
	};
}

export interface WorkPeriodEvent extends CalendarEvent {
	type: "work_period";
	metadata: {
		durationMinutes: number;
		employeeName: string;
	};
}

export interface BreakEvent extends CalendarEvent {
	type: "break";
	metadata: {
		durationMinutes: number;
		employeeName: string;
	};
}
