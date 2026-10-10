"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOwnPositionCaptureAction } from "@/app/[locale]/(app)/settings/position-stamps/actions";
import {
	askForPositionConsent,
	type PositionConsentQuestion,
} from "@/components/position-capture/position-consent-prompt";
import { queryKeys } from "@/lib/query/keys";
import type { ClockCommandPosition } from "../clock-command";
import { takeClockPosition } from "./device-position";

/** What a clock action needs to know about the employee's own position capture. */
export type ClockPositionStatus = {
	/** Capture is on and consent to the current notice is active: take a position. */
	mayCapture: boolean;
	/** Capture is on and the current notice is unanswered: ask after this clock action. */
	asksForConsent: boolean;
	notice: { id: string; version: number; purposeStatement: string; retentionDays: number } | null;
	retentionDays: number;
};

/** The position side of one clock event: what it carries, and what to ask once it is sent. */
export type ClockEventPosition = {
	position: ClockCommandPosition | null;
	/** The consent question to show after the event, never before it. */
	consentQuestion: PositionConsentQuestion | null;
};

/** The spec's five seconds: all a clock event may wait for its status and position together. */
const CLOCK_EVENT_POSITION_BUDGET_MS = 5_000;
const STATUS_WAIT_MS = 1_500;
const NO_POSITION: ClockEventPosition = { position: null, consentQuestion: null };

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

function after<T>(milliseconds: number, value: T) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const elapsed = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(value), milliseconds);
	});
	return { elapsed, cancel: () => clearTimeout(timer) };
}

/**
 * The position side of the employee's own clock actions (#826).
 *
 * `capture` runs at the event: it reads the capture status and, when capture is
 * on and consented, takes one position. Both together add at most five seconds
 * to the clock event. Unknown status, no consent and any failure all mean no
 * position, never a refused or held clock event. The server checks again
 * inside the clocking transaction.
 *
 * When the current notice is unanswered, `capture` returns the consent question
 * instead. The clock action asks it with `askAfterEvent` once the event has
 * been submitted and does not wait for the answer. Consent given there applies
 * to later events only: the server keeps a stamp only when consent was given
 * before the event.
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
		const timeout = after(STATUS_WAIT_MS, null);
		return await (async () => {
			return await Promise.race([
				queryClient.fetchQuery({ queryKey, queryFn: readClockPositionStatus }).catch(() => null),
				timeout.elapsed,
			]);
		})().finally(() => {
			timeout.cancel();
		});
	}

	async function captureWithoutBudget(online: boolean): Promise<ClockEventPosition> {
		const current = await status(online);
		if (!current) return NO_POSITION;
		if (current.mayCapture) {
			return { position: await takeClockPosition().catch(() => null), consentQuestion: null };
		}
		if (!current.asksForConsent || !current.notice || !online) return NO_POSITION;
		return {
			position: null,
			consentQuestion: {
				notice: current.notice,
				retentionDays: Math.min(current.retentionDays, current.notice.retentionDays),
			},
		};
	}

	/** The position this clock event carries, within five seconds in total. */
	async function capture(online: boolean): Promise<ClockEventPosition> {
		if (!enabled) return NO_POSITION;
		const budget = after(CLOCK_EVENT_POSITION_BUDGET_MS, NO_POSITION);
		return await (async () => {
			return await Promise.race([
				captureWithoutBudget(online).catch(() => NO_POSITION),
				budget.elapsed,
			]);
		})().finally(() => {
			budget.cancel();
		});
	}

	/** Shows the consent question after a submitted clock event; never awaited by the event. */
	function askAfterEvent(question: PositionConsentQuestion | null): void {
		if (!question) return;
		void askForPositionConsent(question)
			.then((answer) => {
				if (answer !== "dismissed") void queryClient.invalidateQueries({ queryKey });
			})
			.catch(() => undefined);
	}

	return { capture, askAfterEvent };
}
