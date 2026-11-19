"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { useTimeClock } from "@/lib/query/use-time-clock";
import type { TimeKpiRead } from "@/lib/time-tracking/time-kpis";

/** Reconcile server totals after a confirmed shared-clock change, including another clock surface. */
export function useTimeSummaryClockSync(data?: TimeKpiRead | null) {
	const clock = useTimeClock();
	const router = useRouter();
	const requested = useRef<string | null>(null);
	const active = clock.activeWorkPeriod;
	// The existing clock model retains active work during an in-progress break;
	// its authoritative basis is finalized/split on resume or clock-out.
	const clockStart = active ? instantFromDate(active.startTime).toString() : "";
	const serverStarts =
		data?.basis.liveWork
			.map((work) => instantFromDate(work.startedAt).toString())
			.join("|") ?? "";
	const matches = clockStart === serverStarts;
	useEffect(() => {
		if (matches) {
			requested.current = null;
			return;
		}
		if (!data || clock.isPending || clock.isError || clock.isOffline) return;
		const key = `${clockStart}:${serverStarts}`;
		if (requested.current === key) return;
		requested.current = key;
		router.refresh();
	}, [
		data,
		matches,
		clockStart,
		serverStarts,
		clock.isPending,
		clock.isError,
		clock.isOffline,
		router,
	]);
	return matches;
}
