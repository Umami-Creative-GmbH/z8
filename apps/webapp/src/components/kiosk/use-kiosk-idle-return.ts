"use client";

import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react";
import { KIOSK_CONFIRMATION_MS, KIOSK_IDLE_MS } from "./kiosk-timing";
import { isKioskFlowBusy, type KioskFlow } from "./kiosk-turn-flow";

/**
 * Every screen of an employee's turn returns home on its own; a touch restarts
 * the wait. A note on the home screen (#1366) clears itself like a
 * confirmation. Returns the touch, for every pointer or key press on the kiosk.
 */
export function useKioskIdleReturn(input: {
	flow: KioskFlow;
	setFlow: Dispatch<SetStateAction<KioskFlow>>;
	onIdle: () => void;
}) {
	const { flow, setFlow } = input;
	const [activity, setActivity] = useState(0);

	const returnHome = useEffectEvent(() => input.onIdle());
	const busy = isKioskFlowBusy(flow);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `activity` restarts the idle timer
	useEffect(() => {
		if (flow.step === "home" || busy) return;
		const confirmation = flow.step === "done" || flow.step === "fob-registered";
		const timeout = confirmation ? KIOSK_CONFIRMATION_MS : KIOSK_IDLE_MS;
		const timer = window.setTimeout(() => returnHome(), timeout);
		return () => window.clearTimeout(timer);
	}, [flow, busy, activity]);

	const homeNotice = flow.step === "home" ? (flow.notice ?? null) : null;
	useEffect(() => {
		if (!homeNotice) return;
		const timer = window.setTimeout(
			() => setFlow((current) => (current.step === "home" ? { step: "home" } : current)),
			KIOSK_CONFIRMATION_MS,
		);
		return () => window.clearTimeout(timer);
	}, [homeNotice, setFlow]);

	return () => setActivity((count) => count + 1);
}
