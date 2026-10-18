"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { kioskAcceptsBadgeInput } from "@/lib/time-tracking/kiosk/badge-input";
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
	readUncertainActions,
	rememberUncertainAction,
} from "@/lib/time-tracking/kiosk/uncertain-action";
import { KIOSK_ACTION_REQUEST } from "./kiosk-action-request";
import {
	type AttributionAnswer,
	attributionAskOf,
	KEEP_ATTRIBUTION,
	kioskAttributionRequest,
} from "./kiosk-attribution";
import { KioskAttributionStep } from "./kiosk-attribution-step";
import { KioskBadgeCheck } from "./kiosk-badge-check";
import { KioskCameraScan } from "./kiosk-camera-scan";
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
	attributionFlow,
	badgeCheckedFlow,
	heldFlow,
	isKioskFlowBusy,
	type KioskFlow,
	type KioskTurnConfirmation,
	type KioskTurnProof,
	kioskBadgeBody,
	kioskProofBody,
	type OfflineTurn,
	pinCheckedFlow,
	queueOfflineAction,
	resolvedFlow,
	type VehicleAnswer,
	vehicleAskOf,
	vehicleBackFlow,
} from "./kiosk-turn-flow";
import { KioskUncertainScreen } from "./kiosk-uncertain-screen";
import { KioskVehicleUseStep } from "./kiosk-vehicle-use-step";
import { useKioskBadgeScanner } from "./use-kiosk-badge-scanner";
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

/** An action whose reply was lost (#1363), and whether Z8 could be asked about it yet. */
type PendingAction = { attempt: KioskUncertainAction; check: "checking" | "unavailable" };

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
 *
 * A kiosk that accepts badges (#1366) also opens a turn from a badge read on
 * the home screen (`identifyBadge`, fed by the attached scanner through
 * `KioskHome`); the badge then stands in for the PIN for that turn only, online
 * only, and is never stored. Scans anywhere else are swallowed. A kiosk whose
 * camera input is on (#1367) also offers "Scan badge" there: the camera step
 * reads the badge on the device and feeds the same `identifyBadge`; the camera
 * runs only while that step shows.
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
	const [flow, setFlow] = useState<KioskFlow>({ step: "home" });
	// The screen showing now, for answers that arrive after an await (#1363).
	const shownFlow = useRef(flow);
	useEffect(() => {
		shownFlow.current = flow;
	});
	// Actions whose reply was lost, also before a reload or remount (#1363). Each holds only
	// its own employee; the kiosk keeps checking while everyone else clocks.
	const [pending, setPending] = useState<PendingAction[]>(() =>
		readUncertainActions(initialKiosk.id).map((attempt) => ({ attempt, check: "checking" })),
	);
	const pendingNow = useRef(pending);
	useEffect(() => {
		pendingNow.current = pending;
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

	/** The next screen; a turn that ends on the home screen (with a note) resets the language. */
	function show(flow: KioskFlow) {
		setFlow(flow);
		if (flow.step === "home") language.reset();
	}

	function goHome() {
		show({ step: "home" });
	}

	/** The unresolved action of this employee, if any (#1363). */
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

	// A note on the home screen (#1366) clears itself like a confirmation.
	const homeNotice = flow.step === "home" ? (flow.notice ?? null) : null;
	useEffect(() => {
		if (!homeNotice) return;
		const timer = window.setTimeout(
			() => setFlow((current) => (current.step === "home" ? { step: "home" } : current)),
			KIOSK_CONFIRMATION_MS,
		);
		return () => window.clearTimeout(timer);
	}, [homeNotice]);

	// Attached-scanner badges (#1366): read on the home screen (`KioskHome`), and kept
	// away from every other screen, so no scan switches or changes an employee's turn.
	// The camera scan screen counts as such a screen too (#1367).
	const scanner = kioskAcceptsBadgeInput(kiosk, "scanner");
	useKioskBadgeScanner({ mode: scanner && flow.step !== "home" ? "guard" : "off" });

	// Camera badges (#1367): "Scan badge" on the home screen opens the camera step.
	// An admin who switches the camera input off meanwhile closes it.
	const camera = kioskAcceptsBadgeInput(kiosk, "camera");
	const cameraOpen = flow.step === "camera";
	useEffect(() => {
		if (cameraOpen && !camera) {
			setFlow((current) => (current.step === "camera" ? { step: "home" } : current));
		}
	}, [cameraOpen, camera]);

	/** "Scan badge" (#1367): the camera only online, since a badge turn needs a connection. */
	function scanWithCamera() {
		setFlow(
			contact.online ? { step: "camera" } : { step: "home", notice: { code: "badge_offline" } },
		);
	}

	/**
	 * A badge read on the home screen (#1366), by whatever input read it (the
	 * attached scanner, or #1367 the camera): the badge's employee, state, day
	 * total and actions, or why not. Records nothing. Badge clocking needs a
	 * connection; offline nothing is sent or queued.
	 */
	async function identifyBadge(badge: string, input?: "camera") {
		if (!contact.online) {
			setFlow({ step: "home", notice: { code: "badge_offline" } });
			return;
		}
		setFlow({ step: "badge" });
		const result = await kioskPost<KioskEmployeeSnapshot>(
			token,
			"/api/kiosk/employee-status",
			kioskBadgeBody(badge, input),
			{ timeoutMs: KIOSK_ACTION_TIMEOUT_MS },
		);
		if (result.kind === "kiosk") return kioskRefused(result.code);
		const checked = badgeCheckedFlow({ badge, input, result, contactLost: contact.contactLost });
		const held = checked.step === "employee" ? pendingFor(checked.snapshot.employee.id) : undefined;
		if (held && checked.step === "employee") hold(held, checked);
		else show(checked);
	}

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
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		vehicle?: VehicleAnswer,
		attribution?: AttributionAnswer,
	) {
		setFlow(actingFlow(proof, snapshot, action, vehicle, attribution));
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
			// Only that a badge proved the employee (#1366), never the badge itself.
			...(proof.badge !== undefined ? { via: "badge" as const } : {}),
			// Known before sending, so a recovered confirmation can still warn (#1123).
			...(vehicle?.answer.leftOut ? { vehicleUseLeftOut: true as const } : {}),
		};
		rememberUncertainAction(attempt);
		const result = await kioskPost<KioskClockResult>(
			token,
			"/api/kiosk/clock",
			{
				...kioskProofBody(proof, snapshot.employee.id),
				action: attempt.request,
				operationId: attempt.operationId,
				...(vehicleUse ? { vehicleUse } : {}),
				// The clock-out's project and work category (#887); a kept one is left out.
				...(attribution ? kioskAttributionRequest(attribution.values) : {}),
			},
			{ timeoutMs: KIOSK_ACTION_TIMEOUT_MS },
		);
		if (result.kind === "kiosk") {
			// Refused with the device token: the action never ran.
			forgetUncertainAction(attempt.operationId);
			return kioskRefused(result.code);
		}
		const acted = actedFlow({ proof, snapshot, action, attempt, vehicle, attribution, result });
		if (acted.step === "uncertain") {
			setPending((entries) => [
				...entries.filter((entry) => entry.attempt.operationId !== attempt.operationId),
				{ attempt, check: "checking" },
			]);
		} else {
			forgetUncertainAction(attempt.operationId);
		}
		show(acted);
	}

	/**
	 * Asks Z8 once what became of an unresolved action (#1363); never sends the
	 * action again. While its screen shows, the answer replaces it. Otherwise
	 * (the employee went home, someone else is clocking) a committed or
	 * conflicting answer is kept for when they identify again, and a definitive
	 * "not recorded" simply frees them to act afresh.
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
		if (result.kind === "kiosk") return kioskRefused(result.code);
		const current = shownFlow.current;
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
	}, [pending, contact.online]);

	/** An offline action (#1292): frozen and queued on this kiosk, confirmed by Z8 later. */
	async function actOffline(turn: OfflineTurn, action: KioskPanelAction, vehicle?: VehicleAnswer) {
		setFlow(actingOfflineFlow(turn, action, vehicle));
		const failed = t(
			"timeTracking.kiosk.offline.notSaved",
			"This could not be saved on the kiosk. Nothing was recorded.",
		);
		setFlow(await queueOfflineAction({ token, kiosk, turn, action, vehicle, failed }));
	}

	/**
	 * An action's button: first the project and work category when an online
	 * clock-out asks them (#887), then the vehicle step when the action asks
	 * vehicle use (#1123).
	 */
	function choose(
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
	) {
		const ask = attributionAskOf(action, snapshot.attribution);
		if (ask) {
			setFlow(attributionFlow(proof, snapshot, action, { ask, values: KEEP_ATTRIBUTION }));
			return;
		}
		proceed(proof, snapshot, action);
	}

	/** After the project and work category, if asked: the vehicle step, or the action. */
	function proceed(
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		attribution?: AttributionAnswer,
	) {
		const ask = vehicleAskOf(action, snapshot.vehicleUse);
		if (ask) {
			setFlow({
				step: "vehicle",
				proof,
				snapshot,
				action,
				ask,
				...(attribution ? { attribution } : {}),
				pending: false,
			});
			return;
		}
		void act(proof, snapshot, action, undefined, attribution);
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
						notice={flow.notice ?? null}
						{...(scanner
							? {
									onBadge: (badge: string) => void identifyBadge(badge),
									onBadgeUnreadable: () =>
										setFlow({ step: "home", notice: { code: "badge_unreadable" } }),
								}
							: {})}
						{...(camera ? { onScanBadge: scanWithCamera } : {})}
						onChooseLanguage={language.choose}
						onPick={(employee) => {
							const held = pendingFor(employee.id);
							if (held) hold(held);
							else setFlow({ step: "pin", employee, attempt: 0, busy: false, error: null });
						}}
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
					onCameraBadge={(badge) => void identifyBadge(badge, "camera")}
					onVerifyPin={(employee, attempt, pin) => void verifyPin(employee, attempt, pin)}
					onChoose={choose}
					onProceed={proceed}
					onAct={(proof, snapshot, action, vehicle, attribution) =>
						void act(proof, snapshot, action, vehicle, attribution)
					}
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
	onCameraBadge,
	onVerifyPin,
	onChoose,
	onProceed,
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
	/** A badge the camera step read (#1367). */
	onCameraBadge: (badge: string) => void;
	onVerifyPin: (employee: KioskEmployeeListing, attempt: number, pin: string) => void;
	onChoose: (
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
	) => void;
	/** The project and work category were answered (#887): what the action asks next. */
	onProceed: (
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		attribution: AttributionAnswer,
	) => void;
	onAct: (
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		vehicle: VehicleAnswer,
		attribution?: AttributionAnswer,
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
		case "camera":
			return (
				<KioskCameraScan
					key="camera"
					onBadge={onCameraBadge}
					onProblem={(problem) => onFlow({ step: "home", notice: { code: problem } })}
					onCancel={onHome}
				/>
			);
		case "badge":
			return <KioskBadgeCheck key="badge" />;
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
					onAction={(action) => onChoose(flow.proof, flow.snapshot, action)}
					onBack={onHome}
				/>
			);
		case "attribution":
			return (
				<KioskAttributionStep
					key="attribution"
					name={flow.snapshot.employee.name}
					attribution={flow.ask}
					values={flow.values}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={!online}
					error={flow.error ? message(flow.error) : null}
					onConfirm={(values) =>
						onProceed(flow.proof, flow.snapshot, flow.action, { ask: flow.ask, values })
					}
					onBack={() =>
						onFlow({
							step: "employee",
							proof: flow.proof,
							snapshot: flow.snapshot,
							pending: null,
							error: null,
						})
					}
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
						onAct(
							flow.proof,
							flow.snapshot,
							flow.action,
							{ ask: flow.ask, answer },
							flow.attribution,
						)
					}
					onBack={() => onFlow(vehicleBackFlow(flow))}
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
