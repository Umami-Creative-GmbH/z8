import {
	ShiftDateGridEvent,
	ShiftMonthGridEvent,
	ShiftTimeGridEvent,
} from "./shift-calendar-event";

/** The Schedule-X custom components that draw shifts in each grid. */
export const shiftCalendarEventComponents = {
	timeGridEvent: ShiftTimeGridEvent,
	dateGridEvent: ShiftDateGridEvent,
	monthGridEvent: ShiftMonthGridEvent,
};
