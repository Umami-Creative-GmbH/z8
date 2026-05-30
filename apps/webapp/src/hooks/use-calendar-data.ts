"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type {
	CalendarEvent,
	DailyWorkActualMinutes,
	DailyWorkRequirements,
} from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { queryKeys } from "@/lib/query/keys";
import { parseSuperJsonResponse } from "@/lib/superjson";
import {
	calendarEventSchema,
	dailyWorkActualMinutesSchema,
	dailyWorkRequirementsSchema,
} from "@/lib/validations/calendar";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";

const employeeWorkBalanceSchema = z.object({
	employeeId: z.string(),
	organizationId: z.string(),
	actualMinutes: z.number().int(),
	requiredMinutes: z.number().int(),
	balanceMinutes: z.number().int(),
	computedFromDate: z.string(),
	computedThroughDate: z.string(),
	computedAt: z.coerce.date(),
});

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
	dailyRequirements: DailyWorkRequirements;
	dailyActualMinutes: DailyWorkActualMinutes;
	workBalance: EmployeeWorkBalancePayload | null;
	calendarTimezone: string | null;
	eventsByDate: Map<string, CalendarEvent[]>;
	isLoading: boolean;
	isFetching: boolean;
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
): Promise<{
	events: CalendarEvent[];
	dailyRequirements: DailyWorkRequirements;
	dailyActualMinutes: DailyWorkActualMinutes;
	workBalance: EmployeeWorkBalancePayload | null;
	calendarTimezone: string | null;
}> {
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
	const data = await parseSuperJsonResponse<{
		events: unknown[];
		total: number;
		dailyRequirements?: unknown;
		dailyActualMinutes?: unknown;
		workBalance?: unknown;
		calendarTimezone?: unknown;
	}>(response);

	// Validate events with Zod schema
	const eventsSchema = z.array(calendarEventSchema);
	return {
		events: eventsSchema.parse(data.events),
		dailyRequirements: dailyWorkRequirementsSchema.parse(data.dailyRequirements ?? {}),
		dailyActualMinutes: dailyWorkActualMinutesSchema.parse(data.dailyActualMinutes ?? {}),
		workBalance: employeeWorkBalanceSchema.nullable().parse(data.workBalance ?? null),
		calendarTimezone: z
			.string()
			.nullable()
			.parse(data.calendarTimezone ?? null),
	};
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

	const {
		data: calendarData = {
			events: [],
			dailyRequirements: {},
			dailyActualMinutes: {},
			workBalance: null,
			calendarTimezone: null,
		},
		isLoading,
		isFetching,
		error,
	} = useQuery({
		queryKey: queryKeys.calendar.events(organizationId, queryParams),
		queryFn: () =>
			fetchCalendarEvents(organizationId, year, fullYear ? undefined : month, fullYear, filters),
		staleTime: 30 * 1000, // 30 seconds - calendar data can change frequently
		enabled: !!organizationId,
	});

	// Group events by date for easy lookup (memoized)
	const eventsByDate = (() => {
		return calendarData.events.reduce((acc, event) => {
			const dateKey = format(event.date, "yyyy-MM-dd");
			if (!acc.has(dateKey)) {
				acc.set(dateKey, []);
			}
			acc.get(dateKey)?.push(event);
			return acc;
		}, new Map<string, CalendarEvent[]>());
	})();

	// Refetch function that invalidates the query cache
	const refetch = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.calendar.events(organizationId, queryParams),
		});
	};

	return {
		events: calendarData.events,
		dailyRequirements: calendarData.dailyRequirements,
		dailyActualMinutes: calendarData.dailyActualMinutes,
		workBalance: calendarData.workBalance,
		calendarTimezone: calendarData.calendarTimezone,
		eventsByDate,
		isLoading,
		isFetching,
		error: error instanceof Error ? error : null,
		refetch,
	};
}
