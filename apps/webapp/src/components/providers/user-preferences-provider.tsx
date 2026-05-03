"use client";

import { createContext, type ReactNode, useContext } from "react";
import {
	DEFAULT_WEEK_START_DAY,
	normalizeWeekStartDay,
	type WeekStartDay,
} from "@/lib/user-preferences/week-start";

const UserPreferencesContext = createContext<{ weekStartDay: WeekStartDay }>({
	weekStartDay: DEFAULT_WEEK_START_DAY,
});

export function UserPreferencesProvider({
	children,
	weekStartDay,
}: {
	children: ReactNode;
	weekStartDay?: string | null;
}) {
	return (
		<UserPreferencesContext.Provider value={{ weekStartDay: normalizeWeekStartDay(weekStartDay) }}>
			{children}
		</UserPreferencesContext.Provider>
	);
}

export function useWeekStartDay() {
	return useContext(UserPreferencesContext).weekStartDay;
}
