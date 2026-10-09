"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOwnPositionCaptureAction } from "@/app/[locale]/(app)/settings/position-stamps/actions";
import { askForPositionConsent } from "@/components/position-capture/position-consent-prompt";
import { queryKeys } from "@/lib/query/keys";
import type { ClockCommandPosition } from "../clock-command";
import { takeClockPosition } from "./device-position";

/** What a clock action needs to know about the employee's own position capture. */
export type ClockPositionStatus = {
	/** Capture is on and consent to the current notice is active: take a position. */
	mayCapture: boolean;
	/** Capture is on and the current notice is unanswered: ask on this clock action. */
	asksForConsent: boolean;
	notice: { id: string; version: number; purposeStatement: string; retentionDays: number } | null;
	retentionDays: number;
};

const STATUS_WAIT_MS = 1_500;

async function readClockPositionStatus(): Promise<ClockPositionStatus | null> {
	const result = await getOwnPositionCaptureAction();
	if (!result.success) return null;
	const { data } = result;
	return {
		mayCapture: data.captureOn && data.consent.kind === "active",
		asksForConsent: data.asksForConsent,
		notice: data.notice,
		retentionDays: data.retentionDays,
	};
}

/**
 * The position side of the employee's own clock actions (#826). Before a clock
 * action, `decide` asks for consent when the current notice is unanswered (the
 * dialog, online only) and says whether to take a position; `take` then takes
 * one within five seconds. Unknown status, no consent, an unanswered or
 * dismissed dialog, and any failure all mean no position, never a refused or
 * held clock event. The server checks again inside the clocking transaction.
 */
export function useClockPosition(enabled: boolean) {
	const queryClient = useQueryClient();
	const queryKey = queryKeys.timeClock.positionCapture();
	useQuery({
		queryKey,
		queryFn: readClockPositionStatus,
		enabled,
		staleTime: 5 * 60_000,
		retry: false,
	});

	async function status(online: boolean): Promise<ClockPositionStatus | null> {
		const cached = queryClient.getQueryData<ClockPositionStatus | null>(queryKey);
		if (cached !== undefined || !online) return cached ?? null;
		// Not loaded yet: wait briefly, never long enough to hold the clock action up.
		return Promise.race([
			queryClient.fetchQuery({ queryKey, queryFn: readClockPositionStatus }).catch(() => null),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_WAIT_MS)),
		]);
	}

	/** Whether this clock action should carry a position; may ask for consent first. */
	async function decide(online: boolean): Promise<boolean> {
		if (!enabled) return false;
		try {
			const current = await status(online);
			if (!current) return false;
			if (current.mayCapture) return true;
			if (!current.asksForConsent || !current.notice || !online) return false;
			const answer = await askForPositionConsent({
				notice: current.notice,
				retentionDays: Math.min(current.retentionDays, current.notice.retentionDays),
			});
			if (answer !== "dismissed") void queryClient.invalidateQueries({ queryKey });
			return answer === "agreed";
		} catch {
			return false;
		}
	}

	function take(): Promise<ClockCommandPosition | null> {
		return takeClockPosition().catch(() => null);
	}

	return { decide, take };
}
