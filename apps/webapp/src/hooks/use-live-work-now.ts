"use client";

import { useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import type { LiveWork } from "@/lib/calendar/types";
import { type Instant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";

const MINUTE_MS = 60_000;
const NO_INSTANT = 0;

function parseStarts(startsKey: string): number[] {
	return startsKey ? startsKey.split(",").map(Number) : [];
}

/** The latest elapsed-minute boundary any live work has reached, or NO_INSTANT. */
function latestMinuteBoundary(starts: number[], nowMs: number): number {
	let latest = NO_INSTANT;
	for (const start of starts) {
		if (start > nowMs) continue;
		const boundary = start + Math.floor((nowMs - start) / MINUTE_MS) * MINUTE_MS;
		latest = Math.max(latest, boundary);
	}
	return latest;
}

function nextMinuteBoundary(starts: number[], nowMs: number): number {
	let next = Number.POSITIVE_INFINITY;
	for (const start of starts) {
		const boundary =
			start > nowMs ? start : start + (Math.floor((nowMs - start) / MINUTE_MS) + 1) * MINUTE_MS;
		next = Math.min(next, boundary);
	}
	return next;
}

function getServerSnapshot() {
	return NO_INSTANT;
}

/**
 * The current instant as of the latest elapsed-minute boundary of the given
 * live work, so a live day total changes in step with the time clock's minute.
 * Null during server rendering and without live work.
 */
export function useLiveWorkNow(liveWork: LiveWork[]): Instant | null {
	// A primitive key keeps the subscription stable while the same live work runs.
	const startsKey = liveWork
		.map((work) => instantFromDate(work.startedAt).epochMilliseconds)
		.join(",");

	const subscribe = (onStoreChange: () => void) => {
		const starts = parseStarts(startsKey);
		if (starts.length === 0) return () => {};

		let timeout: number | undefined;
		const schedule = () => {
			const nowMs = systemClock.nowInstant().epochMilliseconds;
			timeout = window.setTimeout(() => {
				onStoreChange();
				schedule();
			}, nextMinuteBoundary(starts, nowMs) - nowMs);
		};
		schedule();
		return () => window.clearTimeout(timeout);
	};
	const getSnapshot = () =>
		latestMinuteBoundary(parseStarts(startsKey), systemClock.nowInstant().epochMilliseconds);

	const boundaryMs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	return boundaryMs === NO_INSTANT ? null : Temporal.Instant.fromEpochMilliseconds(boundaryMs);
}
