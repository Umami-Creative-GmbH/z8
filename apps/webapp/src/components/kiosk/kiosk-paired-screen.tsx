"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { kioskFetch, kioskPost, kioskRefusalOf } from "@/lib/kiosk/device";
import { formatKioskTime } from "@/lib/kiosk/display";
import type {
	KioskClockRefusal,
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskRefusalCode,
} from "@/lib/kiosk/protocol";
import { KioskConfirmation } from "./kiosk-confirmation";
import {
	KIOSK_ACTION_REQUEST,
	KioskEmployeePanel,
	type KioskPanelAction,
	useKioskActionLabels,
} from "./kiosk-employee-panel";
import { KioskHome } from "./kiosk-home";
import { useKioskLanguage } from "./kiosk-language";
import { KIOSK_PIN_REFUSALS, useKioskRefusalMessage } from "./kiosk-messages";
import { KioskPinPad } from "./kiosk-pin-pad";

/** How often a paired kiosk checks in, so revocation shows and "last seen" stays current. */
const KIOSK_HEARTBEAT_MS = 60_000;
/** The confirmation returns home on its own after about this long. */
export const KIOSK_CONFIRMATION_MS = 10_000;
/** A PIN pad or employee screen nobody touches returns home after this long. */
export const KIOSK_IDLE_MS = 30_000;

interface KioskPairedScreenProps {
	token: string;
	kiosk: KioskDeviceInfo;
	onRevoked: () => void;
	onUnpaired: () => void;
}

type Confirmation = { name: string; action: KioskPanelAction; at: string; zone: string };

type Flow =
	| { step: "home" }
	| {
			step: "pin";
			employee: KioskEmployeeListing;
			attempt: number;
			busy: boolean;
			error: KioskClockRefusal | "offline" | null;
	  }
	| {
			step: "employee";
			pin: string;
			snapshot: KioskEmployeeSnapshot;
			pending: KioskPanelAction | null;
			error: KioskClockRefusal | "offline" | null;
	  }
	| { step: "done"; confirmation: Confirmation };

/**
 * The time a confirmation shows. Clock-in, break start and resume read it from
 * the state after the action; a day ended on a break ends at the break's
 * start; a clock-out shows the moment it was confirmed.
 */
function confirmationOf(
	action: KioskPanelAction,
	before: KioskEmployeeSnapshot,
	after: KioskClockResult,
	kioskZone: string,
): Confirmation {
	const name = after.employee.name;
	const { state } = after;
	if (action === "start_break" && state.status === "on_break") {
		return { name, action, at: state.breakSince, zone: state.breakZone || kioskZone };
	}
	if ((action === "clock_in" || action === "resume_break") && state.status === "clocked_in") {
		return { name, action, at: state.since, zone: kioskZone };
	}
	if (action === "end_day" && before.state.status === "on_break") {
		return {
			name,
			action,
			at: before.state.breakSince,
			zone: before.state.breakZone || kioskZone,
		};
	}
	return { name, action, at: new Date().toISOString(), zone: kioskZone };
}

/**
 * A paired kiosk (#862): the home screen, then one employee's turn (PIN,
 * state and actions, confirmation), then home again. An employee's data (PIN,
 * state, day total) lives only in this component's state during the turn and
 * is dropped when the kiosk returns home. Clocking needs a connection: while
 * offline the kiosk says so and sends nothing, and it never queues commands.
 */
export function KioskPairedScreen({ token, kiosk, onRevoked, onUnpaired }: KioskPairedScreenProps) {
	const { t } = useTranslate();
	const online = useOnlineStatus();
	const language = useKioskLanguage(kiosk.language);
	const message = useKioskRefusalMessage(kiosk.timezone, language.locale);
	const labels = useKioskActionLabels();
	const [flow, setFlow] = useState<Flow>({ step: "home" });
	const [activity, setActivity] = useState(0);

	function kioskRefused(code: KioskRefusalCode) {
		if (code === "kiosk_revoked") onRevoked();
		else onUnpaired();
	}

	function goHome() {
		setFlow({ step: "home" });
		language.reset();
	}

	const checkIn = useEffectEvent(async () => {
		const response = await kioskFetch(token, "/api/kiosk/session").catch(() => null);
		if (!response) return;
		const refusal = await kioskRefusalOf(response);
		if (refusal) kioskRefused(refusal);
	});

	useEffect(() => {
		const timer = window.setInterval(() => void checkIn(), KIOSK_HEARTBEAT_MS);
		return () => window.clearInterval(timer);
	}, []);

	// Every screen of an employee's turn returns home on its own; a touch restarts the wait.
	const returnHome = useEffectEvent(() => goHome());
	const busy =
		(flow.step === "pin" && flow.busy) || (flow.step === "employee" && flow.pending !== null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `activity` restarts the idle timer
	useEffect(() => {
		if (flow.step === "home" || busy) return;
		const timeout = flow.step === "done" ? KIOSK_CONFIRMATION_MS : KIOSK_IDLE_MS;
		const timer = window.setTimeout(() => returnHome(), timeout);
		return () => window.clearTimeout(timer);
	}, [flow, busy, activity]);

	async function verifyPin(employee: KioskEmployeeListing, attempt: number, pin: string) {
		setFlow({ step: "pin", employee, attempt, busy: true, error: null });
		const result = await kioskPost<KioskEmployeeSnapshot>(token, "/api/kiosk/employee-status", {
			employeeId: employee.id,
			pin,
		});
		if (result.kind === "kiosk") return kioskRefused(result.code);
		if (result.kind === "ok") {
			setFlow({ step: "employee", pin, snapshot: result.body, pending: null, error: null });
			return;
		}
		setFlow({
			step: "pin",
			employee,
			attempt: attempt + 1,
			busy: false,
			error: result.kind === "offline" ? "offline" : result.refusal,
		});
	}

	async function act(pin: string, snapshot: KioskEmployeeSnapshot, action: KioskPanelAction) {
		setFlow({ step: "employee", pin, snapshot, pending: action, error: null });
		const result = await kioskPost<KioskClockResult>(token, "/api/kiosk/clock", {
			employeeId: snapshot.employee.id,
			pin,
			action: KIOSK_ACTION_REQUEST[action],
			operationId: crypto.randomUUID(),
		});
		if (result.kind === "kiosk") return kioskRefused(result.code);
		if (result.kind === "ok") {
			setFlow({
				step: "done",
				confirmation: confirmationOf(action, snapshot, result.body, kiosk.timezone),
			});
			return;
		}
		if (result.kind === "refused" && KIOSK_PIN_REFUSALS.has(result.refusal.code)) {
			const employee = { id: snapshot.employee.id, name: snapshot.employee.name };
			setFlow({ step: "pin", employee, attempt: 1, busy: false, error: result.refusal });
			return;
		}
		const refusal = result.kind === "offline" ? "offline" : result.refusal;
		const after =
			refusal !== "offline" && "state" in refusal && refusal.state && refusal.dayTotal
				? { ...snapshot, state: refusal.state, dayTotal: refusal.dayTotal }
				: snapshot;
		setFlow({ step: "employee", pin, snapshot: after, pending: null, error: refusal });
	}

	return (
		<div
			className="flex flex-1 flex-col gap-4"
			onPointerDownCapture={() => setActivity((count) => count + 1)}
			onKeyDownCapture={() => setActivity((count) => count + 1)}
		>
			{online ? null : (
				<div
					role="alert"
					className="flex items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100"
				>
					<IconWifiOff className="size-6 shrink-0" aria-hidden="true" />
					{t(
						"timeTracking.kiosk.offline.banner",
						"The kiosk is offline. Clocking is not possible until the connection is back.",
					)}
				</div>
			)}
			{flow.step === "home" ? (
				<KioskHome
					token={token}
					kiosk={kiosk}
					locale={language.locale}
					onChooseLanguage={language.choose}
					onPick={(employee) =>
						setFlow({ step: "pin", employee, attempt: 0, busy: false, error: null })
					}
					onKioskRefused={kioskRefused}
				/>
			) : null}
			{flow.step === "pin" ? (
				<KioskPinPad
					key={flow.attempt}
					name={flow.employee.name}
					busy={flow.busy}
					disabled={!online}
					error={flow.error ? message(flow.error) : null}
					onSubmit={(pin) => void verifyPin(flow.employee, flow.attempt, pin)}
					onBack={goHome}
				/>
			) : null}
			{flow.step === "employee" ? (
				<KioskEmployeePanel
					snapshot={flow.snapshot}
					zone={kiosk.timezone}
					locale={language.locale}
					pending={flow.pending}
					disabled={!online}
					error={flow.error ? message(flow.error) : null}
					onAction={(action) => void act(flow.pin, flow.snapshot, action)}
					onBack={goHome}
				/>
			) : null}
			{flow.step === "done" ? (
				<KioskConfirmation
					name={flow.confirmation.name}
					action={labels.done[flow.confirmation.action]}
					time={formatKioskTime(flow.confirmation.at, flow.confirmation.zone, language.locale)}
					note={
						flow.confirmation.action === "end_day"
							? t(
									"timeTracking.kiosk.done.endDayNote",
									"Your day ended at the start of your break.",
								)
							: null
					}
					returnsInMs={KIOSK_CONFIRMATION_MS}
					onHome={goHome}
				/>
			) : null}
		</div>
	);
}
