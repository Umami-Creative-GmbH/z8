"use client";

import { useEffect, useState } from "react";
import type { CalendarEvent } from "@/lib/calendar/types";

export interface CalendarFilters {
	showHolidays: boolean;
	showAbsences: boolean;
	showTimeEntries: boolean;
	showWorkPeriods: boolean;
	employeeId?: string; // Optional filter for specific employee
}

export interface UseCalendarDataOptions {
	organizationId: string;
	month: number; // 0-11 (JS month format)
	year: number;
	filters: CalendarFilters;
}

export interface UseCalendarDataResult {
	events: CalendarEvent[];
	eventsByDate: Map<string, CalendarEvent[]>;
	isLoading: boolean;
	error: Error | null;
	refetch: () => void;
}

/**
 * Hook to fetch and manage calendar events
 */
export function useCalendarData({
	organizationId,
	month,
	year,
	filters,
}: UseCalendarDataOptions): UseCalendarDataResult {
	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const fetchEvents = async () => {
		setIsLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				organizationId,
				month: month.toString(),
				year: year.toString(),
				showHolidays: filters.showHolidays.toString(),
				showAbsences: filters.showAbsences.toString(),
				showTimeEntries: filters.showTimeEntries.toString(),
				showWorkPeriods: filters.showWorkPeriods.toString(),
			});

			// Add employeeId filter if specified
			if (filters.employeeId) {
				params.set("employeeId", filters.employeeId);
			}

			const response = await fetch(`/api/calendar/events?${params}`);

			if (!response.ok) {
				throw new Error(`Failed to fetch calendar events: ${response.statusText}`);
			}

			const data = await response.json();

			// Convert date strings back to Date objects
			const eventsWithDates = data.events.map((event: any) => ({
				...event,
				date: new Date(event.date),
			}));

			setEvents(eventsWithDates);
		} catch (err) {
			setError(err instanceof Error ? err : new Error("Unknown error"));
			setEvents([]);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchEvents();
	}, [fetchEvents]);

	// Group events by date for easy lookup
	const eventsByDate = events.reduce((acc, event) => {
		const dateKey = event.date.toISOString().split("T")[0]; // YYYY-MM-DD
		if (!acc.has(dateKey)) {
			acc.set(dateKey, []);
		}
		acc.get(dateKey)?.push(event);
		return acc;
	}, new Map<string, CalendarEvent[]>());

	return {
		events,
		eventsByDate,
		isLoading,
		error,
		refetch: fetchEvents,
	};
}
