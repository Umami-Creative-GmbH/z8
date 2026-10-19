"use client";

import { type RefObject, useEffect, useEffectEvent, useRef, useState } from "react";
import { kioskPost } from "@/lib/time-tracking/kiosk/device";
import type {
	KioskClockAttemptOutcome,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import {
	forgetUncertainAction,
	type KioskUncertainAction,
	readUncertainActions,
	rememberUncertainAction,
} from "@/lib/time-tracking/kiosk/uncertain-action";
import {
	KIOSK_ACTION_TIMEOUT_MS,
	KIOSK_OUTCOME_FIRST_CHECK_MS,
	KIOSK_OUTCOME_RETRY_MS,
} from "./kiosk-timing";
import { heldFlow, type KioskFlow, resolvedFlow } from "./kiosk-turn-flow";

/** An action whose reply was lost (#1363), and whether Z8 could be asked about it yet. */
type PendingAction = { attempt: KioskUncertainAction; check: "checking" | "unavailable" };

/**
 * A paired kiosk's actions whose reply was lost (#1363), also before a reload or
 * remount. Each holds only its own employee; the kiosk keeps checking while
 * everyone else clocks, and never sends the action again.
 */
export function useKioskUncertainActions(input: {
	token: string;
	kioskId: string;
	/** Coming back online asks again at once. */
	online: boolean;
	/** The screen showing now, for answers that arrive after an await. */
	shownFlow: RefObject<KioskFlow>;
	show: (flow: KioskFlow) => void;
	onKioskRefused: (code: KioskRefusalCode) => void;
}) {
	const { token, show, onKioskRefused } = input;
	const [pending, setPending] = useState<PendingAction[]>(() =>
		readUncertainActions(input.kioskId).map((attempt) => ({ attempt, check: "checking" })),
	);
	const pendingNow = useRef(pending);
	useEffect(() => {
		pendingNow.current = pending;
	});

	/** The unresolved action of this employee, if any. */
	function pendingFor(employeeId: string): PendingAction | undefined {
		return pendingNow.current.find((entry) => entry.attempt.employee.id === employeeId);
	}

	/** Forgets an answered action, once its answer is shown or it needs no showing. */
	function settle(operationId: string) {
		forgetUncertainAction(operationId);
		setPending((entries) => entries.filter((entry) => entry.attempt.operationId !== operationId));
	}

	/**
	 * An employee identified again while an action of theirs is unresolved: the
	 * answer Z8 gave meanwhile (once), or that the kiosk is still checking. They
	 * get no PIN pad and no action until it resolves.
	 */
	function hold(entry: PendingAction, badgeTurn?: Extract<KioskFlow, { step: "employee" }>) {
		if (entry.attempt.resolved) settle(entry.attempt.operationId);
		show(heldFlow(entry.attempt, entry.check, badgeTurn));
	}

	/** An action whose reply was lost: kept, and asked about until Z8 answers. */
	function track(attempt: KioskUncertainAction) {
		setPending((entries) => [
			...entries.filter((entry) => entry.attempt.operationId !== attempt.operationId),
			{ attempt, check: "checking" },
		]);
	}

	/**
	 * Asks Z8 once what became of an unresolved action; never sends the action
	 * again. While its screen shows, the answer replaces it. Otherwise (the
	 * employee went home, someone else is clocking) a committed or conflicting
	 * answer is kept for when they identify again, and a definitive "not
	 * recorded" simply frees them to act afresh.
	 */
	const checkUncertain = useEffectEvent(async (attempt: KioskUncertainAction) => {
		const result = await kioskPost<KioskClockAttemptOutcome>(
			token,
			"/api/kiosk/clock/outcome",
			{
				operationId: attempt.operationId,
				employeeId: attempt.employee.id,
				action: attempt.request,
			},
			{ timeoutMs: KIOSK_ACTION_TIMEOUT_MS },
		);
		// The device token was refused: the action stays unresolved for after pairing again.
		if (result.kind === "kiosk") return onKioskRefused(result.code);
		const current = input.shownFlow.current;
		const onScreen =
			current.step === "uncertain" && current.attempt.operationId === attempt.operationId;
		const answer = result.kind === "ok" ? result.body.outcome : null;
		if (answer !== "committed" && answer !== "not_recorded" && answer !== "conflict") {
			// Not answered yet: ask again later.
			setPending((entries) =>
				entries.map((entry) =>
					entry.attempt.operationId === attempt.operationId
						? { attempt: entry.attempt, check: "unavailable" }
						: entry,
				),
			);
			// A changed screen only: an unchanged one keeps its idle timeout running.
			if (onScreen && current.check === "checking") {
				show({ step: "uncertain", attempt, check: "unavailable" });
			}
			return;
		}
		if (onScreen) {
			settle(attempt.operationId);
			show(resolvedFlow(attempt, result));
			return;
		}
		// Kept, across reloads too, until the employee identifies again.
		const resolved: KioskUncertainAction = {
			...attempt,
			resolved:
				result.kind === "ok" && result.body.outcome === "committed"
					? { outcome: "committed", at: result.body.at }
					: { outcome: answer === "not_recorded" ? "not_recorded" : "conflict" },
		};
		rememberUncertainAction(resolved);
		setPending((entries) =>
			entries.map((entry) =>
				entry.attempt.operationId === attempt.operationId
					? { attempt: resolved, check: entry.check }
					: entry,
			),
		);
	});

	// Waits a little before the first question, so a slow original can still answer itself,
	// then asks again while Z8 cannot answer, and as soon as the kiosk is back online. Each
	// unresolved action is asked about on its own, whatever the screen shows.
	// biome-ignore lint/correctness/useExhaustiveDependencies: coming back online restarts the wait
	useEffect(() => {
		const timers = pending
			.filter((entry) => !entry.attempt.resolved)
			.map((entry) =>
				window.setTimeout(
					() => void checkUncertain(entry.attempt),
					entry.check === "checking" ? KIOSK_OUTCOME_FIRST_CHECK_MS : KIOSK_OUTCOME_RETRY_MS,
				),
			);
		return () => {
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [pending, input.online]);

	return { pendingFor, hold, track };
}
