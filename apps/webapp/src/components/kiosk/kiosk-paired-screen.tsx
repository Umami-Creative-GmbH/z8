"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { kioskFetch, kioskPost, kioskRefusalOf } from "@/lib/time-tracking/kiosk/device";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import type {
	KioskClockRefusal,
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskRefusalCode,
	KioskVehicleUse,
} from "@/lib/time-tracking/kiosk/protocol";
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
import { type KioskVehicleQuestion, kioskVehicleQuestion } from "./kiosk-vehicle-use";
import { type KioskVehicleUseAnswer, KioskVehicleUseStep } from "./kiosk-vehicle-use-step";

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

type Confirmation = {
	name: string;
	action: KioskPanelAction;
	at: string;
	zone: string;
	/** Entered vehicle use could not be recorded; the action ran without it (#1123). */
	vehicleUseLeftOut: boolean;
};

/** An action's vehicle question and the context it asks from (#1123). */
type VehicleAsk = { question: KioskVehicleQuestion; context: KioskVehicleUse };

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
	| {
			/** Vehicle use asked between the action's button and the action (#1123). */
			step: "vehicle";
			pin: string;
			snapshot: KioskEmployeeSnapshot;
			action: KioskPanelAction;
			ask: VehicleAsk;
			pending: boolean;
	  }
	| { step: "done"; confirmation: Confirmation };

/**
 * What a confirmation shows: the time the server recorded for the action (a
 * day ended on a break ends at the break's start), never the device's clock.
 */
function confirmationOf(
	action: KioskPanelAction,
	after: KioskClockResult,
	vehicleUseLeftOut: boolean,
): Confirmation {
	return {
		name: after.employee.name,
		action,
		at: after.at.instant,
		zone: after.at.zone,
		vehicleUseLeftOut,
	};
}

/** The kiosk as the server describes it now, from the heartbeat; null when unreadable. */
async function kioskInfoOf(response: Response): Promise<KioskDeviceInfo | null> {
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as {
		kiosk?: KioskDeviceInfo;
	} | null;
	return body?.kiosk && typeof body.kiosk.boardEnabled === "boolean" ? body.kiosk : null;
}

/**
 * A paired kiosk (#862): the home screen, then one employee's turn (PIN,
 * state and actions, confirmation), then home again. An employee's data (PIN,
 * state, day total) lives only in this component's state during the turn and
 * is dropped when the kiosk returns home. Clocking needs a connection: while
 * offline the kiosk says so and sends nothing, and it never queues commands.
 */
export function KioskPairedScreen({
	token,
	kiosk: pairedKiosk,
	onRevoked,
	onUnpaired,
}: KioskPairedScreenProps) {
	const { t } = useTranslate();
	const online = useOnlineStatus();
	// The heartbeat keeps the kiosk current, so an admin's change (the board switched on) shows
	// without reloading the page.
	const [kiosk, setKiosk] = useState(pairedKiosk);
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
		if (refusal) return kioskRefused(refusal);
		const current = await kioskInfoOf(response);
		if (current) setKiosk(current);
	});

	useEffect(() => {
		const timer = window.setInterval(() => void checkIn(), KIOSK_HEARTBEAT_MS);
		return () => window.clearInterval(timer);
	}, []);

	// Every screen of an employee's turn returns home on its own; a touch restarts the wait.
	const returnHome = useEffectEvent(() => goHome());
	const busy =
		(flow.step === "pin" && flow.busy) ||
		(flow.step === "employee" && flow.pending !== null) ||
		(flow.step === "vehicle" && flow.pending);
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
			setFlow({
				step: "employee",
				pin,
				snapshot: result.body,
				pending: null,
				error: null,
			});
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

	async function act(
		pin: string,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		vehicle?: { ask: VehicleAsk; answer: KioskVehicleUseAnswer },
	) {
		setFlow(
			vehicle
				? {
						step: "vehicle",
						pin,
						snapshot,
						action,
						ask: vehicle.ask,
						pending: true,
					}
				: { step: "employee", pin, snapshot, pending: action, error: null },
		);
		const vehicleUse = vehicle?.answer.vehicleUse;
		const result = await kioskPost<KioskClockResult>(token, "/api/kiosk/clock", {
			employeeId: snapshot.employee.id,
			pin,
			action: KIOSK_ACTION_REQUEST[action],
			operationId: crypto.randomUUID(),
			...(vehicleUse ? { vehicleUse } : {}),
		});
		if (result.kind === "kiosk") return kioskRefused(result.code);
		if (result.kind === "ok") {
			setFlow({
				step: "done",
				confirmation: confirmationOf(action, result.body, vehicle?.answer.leftOut ?? false),
			});
			return;
		}
		if (result.kind === "refused" && KIOSK_PIN_REFUSALS.has(result.refusal.code)) {
			const employee = {
				id: snapshot.employee.id,
				name: snapshot.employee.name,
			};
			setFlow({
				step: "pin",
				employee,
				attempt: 1,
				busy: false,
				error: result.refusal,
			});
			return;
		}
		const refusal = result.kind === "offline" ? "offline" : result.refusal;
		const after =
			refusal !== "offline" && "state" in refusal && refusal.state && refusal.dayTotal
				? { ...snapshot, state: refusal.state, dayTotal: refusal.dayTotal }
				: snapshot;
		setFlow({
			step: "employee",
			pin,
			snapshot: after,
			pending: null,
			error: refusal,
		});
	}

	/** An action's button: the vehicle step first when the action asks vehicle use (#1123). */
	function choose(pin: string, snapshot: KioskEmployeeSnapshot, action: KioskPanelAction) {
		const question = kioskVehicleQuestion(action, snapshot.vehicleUse);
		if (question && snapshot.vehicleUse) {
			const ask = { question, context: snapshot.vehicleUse };
			setFlow({ step: "vehicle", pin, snapshot, action, ask, pending: false });
			return;
		}
		void act(pin, snapshot, action);
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
						setFlow({
							step: "pin",
							employee,
							attempt: 0,
							busy: false,
							error: null,
						})
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
					onAction={(action) => choose(flow.pin, flow.snapshot, action)}
					onBack={goHome}
				/>
			) : null}
			{flow.step === "vehicle" ? (
				<KioskVehicleUseStep
					question={flow.ask.question}
					snapshot={flow.snapshot}
					context={flow.ask.context}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={!online}
					onConfirm={(answer) =>
						void act(flow.pin, flow.snapshot, flow.action, {
							ask: flow.ask,
							answer,
						})
					}
					onBack={() =>
						setFlow({
							step: "employee",
							pin: flow.pin,
							snapshot: flow.snapshot,
							pending: null,
							error: null,
						})
					}
				/>
			) : null}
			{flow.step === "done" ? (
				<KioskDoneScreen
					confirmation={flow.confirmation}
					locale={language.locale}
					labels={labels}
					onHome={goHome}
				/>
			) : null}
		</div>
	);
}

function KioskDoneScreen({
	confirmation,
	locale,
	labels,
	onHome,
}: {
	confirmation: Confirmation;
	locale: string;
	labels: ReturnType<typeof useKioskActionLabels>;
	onHome: () => void;
}) {
	const { t } = useTranslate();
	return (
		<KioskConfirmation
			name={confirmation.name}
			action={labels.done[confirmation.action]}
			time={formatKioskTime(confirmation.at, confirmation.zone, locale)}
			note={
				confirmation.action === "end_day"
					? t("timeTracking.kiosk.done.endDayNote", "Your day ended at the start of your break.")
					: null
			}
			warning={
				confirmation.vehicleUseLeftOut
					? t("timeTracking.vehicleUse.notRecorded", "Vehicle use was not recorded")
					: null
			}
			returnsInMs={KIOSK_CONFIRMATION_MS}
			onHome={onHome}
		/>
	);
}
