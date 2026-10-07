"use client";

import { useState, useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import { compareInstants, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { type FutureDates, nextSubmissionChange } from "@/lib/travel-expenses/future-dates";

/** The longest delay `setTimeout` keeps; a later moment is waited for in steps. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * A primitive key, so the subscription stays put while the same dates are on
 * screen: the ISO dates, then the epoch milliseconds, neither containing `|`.
 */
function futureDatesKey(future: FutureDates): string {
	return [
		future.dates.toSorted().join(","),
		future.instants
			.map((instant) => instant.epochMilliseconds)
			.toSorted((a, b) => a - b)
			.join(","),
	].join("|");
}

function parseFutureDatesKey(key: string): FutureDates {
	const [dates = "", instants = ""] = key.split("|");
	return {
		dates: dates ? dates.split(",") : [],
		instants: instants
			? instants.split(",").map((ms) => Temporal.Instant.fromEpochMilliseconds(Number(ms)))
			: [],
	};
}

/**
 * The instant an editor evaluates its requirements at. It is read once and
 * read again only when one of the dates has happened, so the snapshot stays
 * stable in between and one timer at a time waits for the next moment.
 */
function createSubmissionClock() {
	let now = systemClock.nowInstant();
	return {
		getSnapshot: () => now,
		subscribe(key: string, onStoreChange: () => void) {
			const future = parseFutureDatesKey(key);
			let timeout: number | undefined;
			const schedule = () => {
				const next = nextSubmissionChange(now, future);
				if (!next) return;
				const delay = next.epochMilliseconds - systemClock.nowInstant().epochMilliseconds;
				timeout = window.setTimeout(
					() => {
						const current = systemClock.nowInstant();
						if (compareInstants(current, next) >= 0) {
							now = current;
							onStoreChange();
						}
						schedule();
					},
					Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS),
				);
			};
			schedule();
			return () => window.clearTimeout(timeout);
		},
	};
}

/**
 * The submission clock of a report editor (#685): the current instant, which
 * moves exactly when the earliest future-dated expense, trip end or per diem
 * return on screen has happened, so the Still needed lists and the Submit
 * button update without a save or a reload. The server checks again at
 * submission; this clock only decides what the employee is shown. Like
 * `useLiveWorkNow`, `subscribe` is memoized on `key` by the React Compiler.
 */
export function useSubmissionNow(future: FutureDates): Instant {
	const key = futureDatesKey(future);
	const [clock] = useState(createSubmissionClock);
	const subscribe = (onStoreChange: () => void) => clock.subscribe(key, onStoreChange);
	return useSyncExternalStore(subscribe, clock.getSnapshot, clock.getSnapshot);
}
