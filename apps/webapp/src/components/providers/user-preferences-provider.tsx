"use client";

import { createContext, type ReactNode, useContext } from "react";
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
}>({
	weekStartDay: DEFAULT_WEEK_START_DAY,
	timeFormat: DEFAULT_TIME_FORMAT,
});

export function UserPreferencesProvider({
	children,
	weekStartDay,
	timeFormat,
}: {
	children: ReactNode;
	weekStartDay?: string | null;
	timeFormat?: string | null;
}) {
	return (
		<UserPreferencesContext.Provider
			value={{
				weekStartDay: normalizeWeekStartDay(weekStartDay),
				timeFormat: normalizeTimeFormat(timeFormat),
			}}
		>
			{children}
		</UserPreferencesContext.Provider>
	);
}

export function useWeekStartDay() {
	return useContext(UserPreferencesContext).weekStartDay;
}

export function useTimeFormat() {
	return useContext(UserPreferencesContext).timeFormat;
}
