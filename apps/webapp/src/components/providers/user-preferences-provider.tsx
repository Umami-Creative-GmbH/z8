"use client";

import { createContext, type ReactNode, use } from "react";
import {
	DEFAULT_TIME_FORMAT,
	normalizeTimeFormat,
	type TimeFormat,
} from "@/lib/user-preferences/time-format";
import {
	DEFAULT_WEEK_START_DAY,
	normalizeWeekStartDay,
	type WeekStartDay,
} from "@/lib/user-preferences/week-start";

const UserPreferencesContext = createContext<{
	weekStartDay: WeekStartDay;
	timeFormat: TimeFormat;
	timezone: string;
}>({
	weekStartDay: DEFAULT_WEEK_START_DAY,
	timeFormat: DEFAULT_TIME_FORMAT,
	timezone: "UTC",
});

export function UserPreferencesProvider({
	children,
	weekStartDay,
	timeFormat,
	timezone,
}: {
	children: ReactNode;
	weekStartDay?: string | null;
	timeFormat?: string | null;
	timezone?: string | null;
}) {
	return (
		<UserPreferencesContext.Provider
			value={{
				weekStartDay: normalizeWeekStartDay(weekStartDay),
				timeFormat: normalizeTimeFormat(timeFormat),
				timezone: timezone || "UTC",
			}}
		>
			{children}
		</UserPreferencesContext.Provider>
	);
}

export function useWeekStartDay() {
	return use(UserPreferencesContext).weekStartDay;
}

export function useTimeFormat() {
	return use(UserPreferencesContext).timeFormat;
}

export function useUserTimezone() {
	return use(UserPreferencesContext).timezone;
}
