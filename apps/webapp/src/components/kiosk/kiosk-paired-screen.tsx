"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { kioskPost } from "@/lib/time-tracking/kiosk/device";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import type { KioskOfflineEmployeeView } from "@/lib/time-tracking/kiosk/offline-command";
import type {
	KioskClockAttemptOutcome,
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskOfflineContact,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import {
	forgetUncertainAction,
	type KioskUncertainAction,
	readUncertainAction,
	rememberUncertainAction,
} from "@/lib/time-tracking/kiosk/uncertain-action";
import { KIOSK_ACTION_REQUEST } from "./kiosk-action-request";
import { KioskConfirmation } from "./kiosk-confirmation";
import {
	KioskEmployeePanel,
	type KioskPanelAction,
	useKioskActionLabels,
} from "./kiosk-employee-panel";
import { KioskHome } from "./kiosk-home";
import { useKioskLanguage } from "./kiosk-language";
import { useKioskRefusalMessage } from "./kiosk-messages";
import { KioskPinPad } from "./kiosk-pin-pad";
import { KioskQueueNotices } from "./kiosk-queue-notices";
import {
	actedFlow,
	actingFlow,
	actingOfflineFlow,
	isKioskFlowBusy,
	type KioskFlow,
	type KioskTurnConfirmation,
	type OfflineTurn,
	pinCheckedFlow,
	queueOfflineAction,
	resolvedFlow,
	type VehicleAnswer,
	vehicleAskOf,
} from "./kiosk-turn-flow";
import { KioskUncertainScreen } from "./kiosk-uncertain-screen";
import { KioskVehicleUseStep } from "./kiosk-vehicle-use-step";
import { useKioskOfflineMode } from "./use-kiosk-offline-mode";

/** The confirmation returns home on its own after about this long. */
export const KIOSK_CONFIRMATION_MS = 10_000;
/** A PIN pad or employee screen nobody touches returns home after this long. */
export const KIOSK_IDLE_MS = 30_000;
/** An online action (or outcome question) without an answer after this long is uncertain (#1363). */
export const KIOSK_ACTION_TIMEOUT_MS = 20_000;
/** The first question about an uncertain action waits this long (#1363). */
export const KIOSK_OUTCOME_FIRST_CHECK_MS = 3_000;
/** While Z8 cannot answer, the kiosk asks again this often (#1363). */
export const KIOSK_OUTCOME_RETRY_MS = 5_000;

interface KioskPairedScreenProps {
	token: string;
	kiosk: KioskDeviceInfo;
	/** Opened from the offline-mode kiosk's cache because the server could not be reached (#1291). */
	cached?: boolean;
	/** The opening contact's `offline` answer (#1292): its anchor and sealing key. */
	offline?: KioskOfflineContact;
	onRevoked: () => void;
	onUnpaired: () => void;
}

/**
 * A paired kiosk (#862): the home screen, then one employee's turn (PIN,
 * state and actions, confirmation), then home again. An employee's data (PIN,
 * state, day total) lives only in this component's state during the turn and
 * is dropped when the kiosk returns home. Without offline mode, clocking needs
 * a connection: while offline the kiosk says so and sends nothing.
 *
 * An offline-mode kiosk (#1291) also keeps its kiosk, employees and their
 * states at every contact (`offline-device.ts`), so it opens and lists them
 * through an outage. Offline (#1292) an employee's PIN is sealed for Z8 and
 * their action is queued as a frozen kiosk command; the confirmation says it is
 * saved on this kiosk and not yet confirmed. At each contact the queue is sent
 * (`offline-queue.ts`) and refusals show as notices on the home screen. The
 * contact itself, and what it keeps or deletes, is `useKioskOfflineMode`; the
 * screens of a turn and how they follow each other are `kiosk-turn-flow.ts`.
 */
export function KioskPairedScreen({
	token,
	kiosk: initialKiosk,
	cached = false,
	offline: openingContact,
	onRevoked,
	onUnpaired,
}: KioskPairedScreenProps) {
	const { t } = useTranslate();
	// The heartbeat keeps the kiosk current, so an admin's change (the board switched on) shows
	// without reloading the page.
	const [kiosk, setKiosk] = useState(initialKiosk);
	const language = useKioskLanguage(kiosk.language);
	// An action whose reply was lost before a reload or remount is still being resolved (#1363).
	const [flow, setFlow] = useState<KioskFlow>(() => {
		const attempt = readUncertainAction(initialKiosk.id);
		return attempt ? { step: "uncertain", attempt, check: "checking" } : { step: "home" };
	});
	const [activity, setActivity] = useState(0);

	function kioskRefused(code: KioskRefusalCode) {
		if (code === "kiosk_revoked") onRevoked();
		else onUnpaired();
	}

	const contact = useKioskOfflineMode({
		token,
		kiosk,
		onKiosk: setKiosk,
		cached,
		openingContact,
		locale: language.locale,
		onKioskRefused: kioskRefused,
	});
	const offlineNow = contact.connection !== "online";

	function goHome() {
		setFlow({ step: "home" });
		language.reset();
	}

	// Every screen of an employee's turn returns home on its own; a touch restarts the wait.
	const returnHome = useEffectEvent(() => goHome());
	const busy = isKioskFlowBusy(flow);
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
		setFlow(
			await pinCheckedFlow({
				kiosk,
				employee,
				attempt,
				pin,
				result,
				contactLost: contact.contactLost,
			}),
		);
	}

	async function act(
		pin: string,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		vehicle?: VehicleAnswer,
	) {
		setFlow(actingFlow(pin, snapshot, action, vehicle));
		const vehicleUse = vehicle?.answer.vehicleUse;
		// One identity per explicit action, kept before it is sent, so a lost reply
		// resolves this action instead of making a second one (#1363).
		const attempt: KioskUncertainAction = {
			version: 1,
			kioskId: kiosk.id,
			operationId: crypto.randomUUID(),
			employee: { id: snapshot.employee.id, name: snapshot.employee.name },
			action,
			request: KIOSK_ACTION_REQUEST[action],
			submittedAt: new Date().toISOString(),
		};
		rememberUncertainAction(attempt);
		const result = await kioskPost<KioskClockResult>(
			token,
			"/api/kiosk/clock",
			{
				employeeId: snapshot.employee.id,
				pin,
				action: attempt.request,
				operationId: attempt.operationId,
				...(vehicleUse ? { vehicleUse } : {}),
			},
			{ timeoutMs: KIOSK_ACTION_TIMEOUT_MS },
		);
		if (result.kind === "kiosk") {
			// Refused with the device token: the action never ran.
			forgetUncertainAction(attempt.operationId);
			return kioskRefused(result.code);
		}
		const next = actedFlow({ pin, snapshot, action, attempt, vehicle, result });
		if (next.step !== "uncertain") forgetUncertainAction(attempt.operationId);
		setFlow(next);
	}

	/** Asks Z8 once what became of the uncertain action (#1363); never sends the action again. */
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
		if (result.kind === "kiosk") return kioskRefused(result.code);
		const next = resolvedFlow(attempt, result);
		if (next.step !== "uncertain" || next.check === "conflict") {
			forgetUncertainAction(attempt.operationId);
		}
		setFlow((current) =>
			current.step === "uncertain" && current.attempt.operationId === attempt.operationId
				? next
				: current,
		);
	});

	const uncertain = flow.step === "uncertain" && flow.check !== "conflict" ? flow : null;
	// Waits a little before the first question, so a slow original can still answer itself,
	// then asks again while Z8 cannot answer, and as soon as the kiosk is back online.
	// biome-ignore lint/correctness/useExhaustiveDependencies: coming back online restarts the wait
	useEffect(() => {
		if (!uncertain) return;
		const delay =
			uncertain.check === "checking" ? KIOSK_OUTCOME_FIRST_CHECK_MS : KIOSK_OUTCOME_RETRY_MS;
		const timer = window.setTimeout(() => void checkUncertain(uncertain.attempt), delay);
		return () => window.clearTimeout(timer);
	}, [uncertain, contact.online]);

	/** An offline action (#1292): frozen and queued on this kiosk, confirmed by Z8 later. */
	async function actOffline(turn: OfflineTurn, action: KioskPanelAction, vehicle?: VehicleAnswer) {
		setFlow(actingOfflineFlow(turn, action, vehicle));
		const failed = t(
			"timeTracking.kiosk.offline.notSaved",
			"This could not be saved on the kiosk. Nothing was recorded.",
		);
		setFlow(await queueOfflineAction({ token, kiosk, turn, action, vehicle, failed }));
	}

	/** An action's button: the vehicle step first when the action asks vehicle use (#1123). */
	function choose(pin: string, snapshot: KioskEmployeeSnapshot, action: KioskPanelAction) {
		const ask = vehicleAskOf(action, snapshot.vehicleUse);
		if (ask) {
			setFlow({ step: "vehicle", pin, snapshot, action, ask, pending: false });
			return;
		}
		void act(pin, snapshot, action);
	}

	function chooseOffline(turn: OfflineTurn, action: KioskPanelAction) {
		const ask = vehicleAskOf(action, turn.view.vehicleUse);
		if (ask) {
			setFlow({ step: "offline-vehicle", turn, action, ask, pending: false });
			return;
		}
		void actOffline(turn, action);
	}

	return (
		<div
			className="flex flex-1 flex-col gap-4"
			onPointerDownCapture={() => setActivity((count) => count + 1)}
			onKeyDownCapture={() => setActivity((count) => count + 1)}
		>
			{offlineNow ? <KioskOfflineBanner queueing={contact.connection === "queueing"} /> : null}
			{flow.step === "home" ? (
				<>
					<KioskQueueNotices
						notices={contact.notices}
						zone={kiosk.timezone}
						locale={language.locale}
						onDismiss={contact.dismissNotices}
					/>
					<KioskHome
						token={token}
						kiosk={kiosk}
						contacts={contact.contacts}
						offline={kiosk.offlineMode && offlineNow}
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
				</>
			) : (
				<KioskTurnScreen
					flow={flow}
					kiosk={kiosk}
					online={contact.online}
					locale={language.locale}
					onFlow={setFlow}
					onHome={goHome}
					onVerifyPin={(employee, attempt, pin) => void verifyPin(employee, attempt, pin)}
					onChoose={choose}
					onAct={(pin, snapshot, action, vehicle) => void act(pin, snapshot, action, vehicle)}
					onChooseOffline={chooseOffline}
					onActOffline={(turn, action, vehicle) => void actOffline(turn, action, vehicle)}
				/>
			)}
		</div>
	);
}

/** The banner an offline kiosk shows: whether clockings are saved on it, or not possible. */
function KioskOfflineBanner({ queueing }: { queueing: boolean }) {
	const { t } = useTranslate();
	return (
		<div
			role="alert"
			className="flex items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100"
		>
			<IconWifiOff className="size-6 shrink-0" aria-hidden="true" />
			{queueing
				? t(
						"timeTracking.kiosk.offline.queueBanner",
						"The kiosk is offline. Clockings are saved on this kiosk and confirmed when the connection is back.",
					)
				: t(
						"timeTracking.kiosk.offline.banner",
						"The kiosk is offline. Clocking is not possible until the connection is back.",
					)}
		</div>
	);
}

/** The screen of an employee's turn, by its step (the home screen is the kiosk's own). */
function KioskTurnScreen({
	flow,
	kiosk,
	online,
	locale,
	onFlow,
	onHome,
	onVerifyPin,
	onChoose,
	onAct,
	onChooseOffline,
	onActOffline,
}: {
	flow: Exclude<KioskFlow, { step: "home" }>;
	kiosk: KioskDeviceInfo;
	online: boolean;
	locale: string;
	onFlow: (flow: KioskFlow) => void;
	onHome: () => void;
	onVerifyPin: (employee: KioskEmployeeListing, attempt: number, pin: string) => void;
	onChoose: (pin: string, snapshot: KioskEmployeeSnapshot, action: KioskPanelAction) => void;
	onAct: (
		pin: string,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		vehicle: VehicleAnswer,
	) => void;
	onChooseOffline: (turn: OfflineTurn, action: KioskPanelAction) => void;
	onActOffline: (turn: OfflineTurn, action: KioskPanelAction, vehicle: VehicleAnswer) => void;
}) {
	const message = useKioskRefusalMessage(kiosk.timezone, locale);
	const labels = useKioskActionLabels();
	const queuedNotice = useQueuedNotice();

	switch (flow.step) {
		case "pin":
			return (
				<KioskPinPad
					key={`pin-${flow.attempt}`}
					name={flow.employee.name}
					busy={flow.busy}
					disabled={!online && !kiosk.offlineMode}
					error={flow.error ? message(flow.error) : null}
					onSubmit={(pin) => onVerifyPin(flow.employee, flow.attempt, pin)}
					onBack={onHome}
				/>
			);
		case "employee":
			return (
				<KioskEmployeePanel
					key="employee"
					snapshot={flow.snapshot}
					zone={kiosk.timezone}
					locale={locale}
					pending={flow.pending}
					disabled={!online}
					error={flow.error ? message(flow.error) : null}
					onAction={(action) => onChoose(flow.pin, flow.snapshot, action)}
					onBack={onHome}
				/>
			);
		case "vehicle":
			return (
				<KioskVehicleUseStep
					key="vehicle"
					question={flow.ask.question}
					snapshot={flow.snapshot}
					context={flow.ask.context}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={!online}
					onConfirm={(answer) =>
						onAct(flow.pin, flow.snapshot, flow.action, {
							ask: flow.ask,
							answer,
						})
					}
					onBack={() =>
						onFlow({
							step: "employee",
							pin: flow.pin,
							snapshot: flow.snapshot,
							pending: null,
							error: null,
						})
					}
				/>
			);
		case "cached":
			return (
				<KioskEmployeePanel
					key="cached"
					snapshot={{
						employee: { id: flow.employee.id, name: flow.employee.name },
						state: flow.employee.state,
						asOf: flow.employee.learnedAt,
					}}
					zone={kiosk.timezone}
					locale={locale}
					pending={null}
					disabled
					error={null}
					onAction={() => undefined}
					onBack={onHome}
				/>
			);
		case "offline":
			return (
				<KioskEmployeePanel
					key="offline"
					snapshot={{
						employee: flow.turn.view.employee,
						state: flow.turn.view.state,
						asOf: flow.turn.view.learnedAt,
					}}
					zone={kiosk.timezone}
					locale={locale}
					pending={flow.pending}
					disabled={false}
					error={flow.error}
					notice={queuedNotice(flow.turn.view)}
					onAction={(action) => onChooseOffline(flow.turn, action)}
					onBack={onHome}
				/>
			);
		case "offline-vehicle":
			return (
				<KioskVehicleUseStep
					key="offline-vehicle"
					question={flow.ask.question}
					snapshot={flow.turn.view}
					context={flow.ask.context}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={false}
					onConfirm={(answer) => onActOffline(flow.turn, flow.action, { ask: flow.ask, answer })}
					onBack={() =>
						onFlow({
							step: "offline",
							turn: flow.turn,
							pending: null,
							error: null,
						})
					}
				/>
			);
		case "uncertain":
			return (
				<KioskUncertainScreen
					key="uncertain"
					attempt={flow.attempt}
					actionLabel={labels.buttons[flow.attempt.action]}
					check={flow.check}
					onHome={onHome}
				/>
			);
		case "done":
			return (
				<KioskDoneScreen
					key="done"
					confirmation={flow.confirmation}
					locale={locale}
					labels={labels}
					onHome={onHome}
				/>
			);
	}
}

/** What an offline employee panel notes about the state it shows (#1292). */
function useQueuedNotice() {
	const { t } = useTranslate();
	return (view: KioskOfflineEmployeeView) =>
		view.queued > 0
			? t(
					"timeTracking.kiosk.offline.stateQueued",
					"The kiosk is offline. This includes clockings saved on this kiosk that are not yet confirmed.",
				)
			: t(
					"timeTracking.kiosk.offline.stateNote",
					"The kiosk is offline. What you do now is saved on this kiosk and not yet confirmed.",
				);
}

function KioskDoneScreen({
	confirmation,
	locale,
	labels,
	onHome,
}: {
	confirmation: KioskTurnConfirmation;
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
			unconfirmed={
				confirmation.unconfirmed
					? t(
							"timeTracking.kiosk.done.unconfirmed",
							"Saved on this kiosk, not yet confirmed. Your PIN is checked when the kiosk is back online.",
						)
					: null
			}
			returnsInMs={KIOSK_CONFIRMATION_MS}
			onHome={onHome}
		/>
	);
}
