"use client";

import { useState, useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { nextSubmissionChange, type SubmissionDeadlines } from "@/lib/travel-expenses/future-dates";

/** The longest delay `setTimeout` keeps; a later deadline is waited for in steps. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** A primitive key, so the subscription stays put while the same deadlines are on screen. */
function deadlinesKey(deadlines: SubmissionDeadlines): string {
	return JSON.stringify([
		deadlines.dates.toSorted(),
		deadlines.instants.map((instant) => instant.epochMilliseconds).toSorted((a, b) => a - b),
	]);
}

function parseDeadlinesKey(key: string): SubmissionDeadlines {
	const [dates, instants] = JSON.parse(key) as [string[], number[]];
	return { dates, instants: instants.map((ms) => Temporal.Instant.fromEpochMilliseconds(ms)) };
}

/**
 * The instant an editor evaluates its requirements at. It is read once and
 * read again only when a deadline passes, so the snapshot stays stable
 * between deadlines and one timer at a time waits for the next one.
 */
function createSubmissionClock() {
	let now = systemClock.nowInstant();
	return {
		getSnapshot: () => now,
		subscribe(key: string, onStoreChange: () => void) {
			const deadlines = parseDeadlinesKey(key);
			let timeout: number | undefined;
			const schedule = () => {
				const next = nextSubmissionChange(now, deadlines);
				if (!next) return;
				const delay = next.epochMilliseconds - systemClock.nowInstant().epochMilliseconds;
				timeout = window.setTimeout(
					() => {
						const current = systemClock.nowInstant();
						if (Temporal.Instant.compare(current, next) >= 0) {
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
 * moves exactly when the earliest future-date blocker on screen expires, so
 * the Still needed lists and the Submit button unblock without a save or a
 * reload. The server checks again at submission; this clock only decides what
 * the employee is shown.
 */
export function useSubmissionNow(deadlines: SubmissionDeadlines): Instant {
	const key = deadlinesKey(deadlines);
	const [clock] = useState(createSubmissionClock);
	const subscribe = (onStoreChange: () => void) => clock.subscribe(key, onStoreChange);
	return useSyncExternalStore(subscribe, clock.getSnapshot, clock.getSnapshot);
}
