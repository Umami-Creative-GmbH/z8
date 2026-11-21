"use client";

import { useSyncExternalStore } from "react";
import { dayHasEntriesOrChange } from "@/lib/payroll-period/day-entries";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";

/**
 * The grid's dates once days without entries are hidden: a date stays while any
 * employee shown has entries on it, or a day changed since settled
 * (`dayHasEntriesOrChange`), so every employee row keeps the same columns.
 */
export function datesWithEntries(
	dates: readonly string[],
	employees: readonly Pick<PayrollPeriodEmployee, "days">[],
): string[] {
	const kept = new Set<string>();
	for (const employee of employees) {
		for (const day of employee.days) {
			if (dayHasEntriesOrChange(day)) kept.add(day.date);
		}
	}
	return dates.filter((date) => kept.has(date));
}

/** One employee's days once days without entries are hidden, for the list. */
export function daysWithEntries(days: readonly PayrollPeriodDay[]): PayrollPeriodDay[] {
	return days.filter(dayHasEntriesOrChange);
}

const STORAGE_KEY = "z8.payroll.days.hideEmptyDays";

/** The choice while storage is unavailable, for the rest of the visit. */
let unstoredChoice = false;
const listeners = new Set<() => void>();

function readHideEmptyDays(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "true";
	} catch {
		return unstoredChoice;
	}
}

function subscribeHideEmptyDays(listener: () => void): () => void {
	listeners.add(listener);
	// Another tab changing the choice.
	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

function writeHideEmptyDays(hide: boolean) {
	unstoredChoice = hide;
	try {
		if (hide) window.localStorage.setItem(STORAGE_KEY, "true");
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Storage unavailable (private window, blocked site data): it lasts for this visit.
	}
	for (const listener of listeners) listener();
}

/**
 * Whether the Days tab hides days without entries, remembered in this browser. The
 * server render shows every day; the client then reads the stored choice.
 */
export function useHideEmptyPayrollDays(): [boolean, (hide: boolean) => void] {
	const hide = useSyncExternalStore(subscribeHideEmptyDays, readHideEmptyDays, () => false);
	return [hide, writeHideEmptyDays];
}
