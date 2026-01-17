"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { queryKeys } from "@/lib/query/keys";
import { parseSuperJsonResponse } from "@/lib/superjson";
import { calendarEventSchema } from "@/lib/validations/calendar";

export interface CalendarFilters {
	showHolidays: boolean;
	showAbsences: boolean;
	showTimeEntries: boolean;
	showWorkPeriods: boolean;
	employeeId?: string;
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
 * Fetch calendar events from API
 */
async function fetchCalendarEvents(
	organizationId: string,
	year: number,
	month: number | undefined,
	fullYear: boolean,
	filters: CalendarFilters,
): Promise<CalendarEvent[]> {
	const params = new URLSearchParams({
		organizationId,
		year: year.toString(),
		showHolidays: filters.showHolidays.toString(),
		showAbsences: filters.showAbsences.toString(),
		showTimeEntries: filters.showTimeEntries.toString(),
		showWorkPeriods: filters.showWorkPeriods.toString(),
	});

	if (fullYear) {
		params.set("fullYear", "true");
	} else if (month !== undefined) {
		params.set("month", month.toString());
	}

	if (filters.employeeId) {
		params.set("employeeId", filters.employeeId);
	}

	const response = await fetch(`/api/calendar/events?${params}`);

	if (!response.ok) {
		throw new Error(`Failed to fetch calendar events: ${response.statusText}`);
	}

	// Use SuperJSON to parse response - dates are now actual Date objects
	const data = await parseSuperJsonResponse<{ events: unknown[]; total: number }>(response);

	// Validate events with Zod schema
	const eventsSchema = z.array(calendarEventSchema);
	return eventsSchema.parse(data.events);
}

/**
 * Hook to fetch and manage calendar events using React Query
 *
 * Benefits over manual fetch:
 * - Automatic request deduplication
 * - Caching with stale-while-revalidate
 * - Built-in loading/error states
 * - Automatic refetch on window focus (configurable)
 * - Auth error handling via QueryProvider
 */
export function useCalendarData({
	organizationId,
	month,
	year,
	filters,
	fullYear = false,
}: UseCalendarDataOptions): UseCalendarDataResult {
	const queryClient = useQueryClient();

	const queryParams = {
		year,
		month: fullYear ? undefined : month,
		fullYear,
		filters,
	};

	const { data: events = [], isLoading, error } = useQuery({
		queryKey: queryKeys.calendar.events(organizationId, queryParams),
		queryFn: () => fetchCalendarEvents(
			organizationId,
			year,
			fullYear ? undefined : month,
			fullYear,
			filters,
		),
		staleTime: 30 * 1000, // 30 seconds - calendar data can change frequently
		enabled: !!organizationId,
	});

	// Group events by date for easy lookup (memoized)
	const eventsByDate = useMemo(() => {
		return events.reduce((acc, event) => {
			const dateKey = format(event.date, "yyyy-MM-dd");
			if (!acc.has(dateKey)) {
				acc.set(dateKey, []);
			}
			acc.get(dateKey)?.push(event);
			return acc;
		}, new Map<string, CalendarEvent[]>());
	}, [events]);

	// Refetch function that invalidates the query cache
	const refetch = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.calendar.events(organizationId, queryParams),
		});
	};

	return {
		events,
		eventsByDate,
		isLoading,
		error: error instanceof Error ? error : null,
		refetch,
	};
}
