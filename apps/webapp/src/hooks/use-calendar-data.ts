"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { ApiError } from "@/lib/fetch";
import { calendarEventSchema } from "@/lib/validations/calendar";

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
	fullYear?: boolean; // Fetch all 12 months for year view
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
	fullYear = false,
}: UseCalendarDataOptions): UseCalendarDataResult {
	const router = useRouter();
	const [events, setEvents] = useState<CalendarEvent[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const fetchEvents = useCallback(async () => {
		setIsLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				organizationId,
				year: year.toString(),
				showHolidays: filters.showHolidays.toString(),
				showAbsences: filters.showAbsences.toString(),
				showTimeEntries: filters.showTimeEntries.toString(),
				showWorkPeriods: filters.showWorkPeriods.toString(),
			});

			// For year view, fetch all 12 months; otherwise fetch single month
			if (fullYear) {
				params.set("fullYear", "true");
			} else {
				params.set("month", month.toString());
			}

			// Add employeeId filter if specified
			if (filters.employeeId) {
				params.set("employeeId", filters.employeeId);
			}

			const response = await fetch(`/api/calendar/events?${params}`);

			if (!response.ok) {
				// Redirect to sign-in on 401 unauthorized
				if (response.status === 401) {
					router.replace("/sign-in");
					return;
				}
				throw new ApiError(
					`Failed to fetch calendar events: ${response.statusText}`,
					response.status,
					response.statusText,
				);
			}

			const data = await response.json();

			// Validate and parse events with Zod schema
			// This automatically converts date strings to Date objects
			const eventsSchema = z.array(calendarEventSchema);
			const parsedEvents = eventsSchema.parse(data.events);

			setEvents(parsedEvents);
		} catch (err) {
			// Also check for ApiError 401 in case it was thrown elsewhere
			if (err instanceof ApiError && err.isUnauthorized()) {
				router.replace("/sign-in");
				return;
			}
			setError(err instanceof Error ? err : new Error("Unknown error"));
			setEvents([]);
		} finally {
			setIsLoading(false);
		}
	}, [
		organizationId,
		month,
		year,
		fullYear,
		filters.showHolidays,
		filters.showAbsences,
		filters.showTimeEntries,
		filters.showWorkPeriods,
		filters.employeeId,
		router,
	]);

	useEffect(() => {
		fetchEvents();
	}, [fetchEvents]);

	// Group events by date for easy lookup
	// Use date-fns format instead of fragile string manipulation
	const eventsByDate = events.reduce((acc, event) => {
		const dateKey = format(event.date, "yyyy-MM-dd"); // YYYY-MM-DD
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
