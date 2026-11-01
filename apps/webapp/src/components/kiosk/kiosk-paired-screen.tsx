"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { kioskAcceptsBadgeInput } from "@/lib/time-tracking/kiosk/badge-input";
import { kioskPost } from "@/lib/time-tracking/kiosk/device";
import type {
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskFobLookup,
	KioskFobRegistrationResult,
	KioskOfflineContact,
	KioskRefusalCode,
} from "@/lib/time-tracking/kiosk/protocol";
import {
	forgetUncertainAction,
	type KioskUncertainAction,
	rememberUncertainAction,
} from "@/lib/time-tracking/kiosk/uncertain-action";
import { KIOSK_ACTION_REQUEST } from "./kiosk-action-request";
import {
	type AttributionAnswer,
	attributionAskOf,
	KEEP_ATTRIBUTION,
	kioskAttributionRequest,
} from "./kiosk-attribution";
import type { KioskPanelAction } from "./kiosk-employee-panel";
import { KioskHome } from "./kiosk-home";
import { useKioskLanguage } from "./kiosk-language";
import { KioskQueueNotices } from "./kiosk-queue-notices";
import { KIOSK_ACTION_TIMEOUT_MS } from "./kiosk-timing";
import {
	actedFlow,
	actingFlow,
	actingOfflineFlow,
	attributionFlow,
	badgeCheckedFlow,
	fobCheckedFlow,
	fobRegisteredFlow,
	isFobRegistrationStep,
	type KioskFlow,
	type KioskTurnProof,
	kioskBadgeBody,
	kioskProofBody,
	type OfflineTurn,
	pinCheckedFlow,
	queueOfflineAction,
	type VehicleAnswer,
	vehicleAskOf,
} from "./kiosk-turn-flow";
import { KioskTurnScreen } from "./kiosk-turn-screen";
import { useKioskBadgeScanner } from "./use-kiosk-badge-scanner";
import { useKioskIdleReturn } from "./use-kiosk-idle-return";
import { useKioskOfflineMode } from "./use-kiosk-offline-mode";
import { useKioskUncertainActions } from "./use-kiosk-uncertain-actions";

export {
	KIOSK_ACTION_TIMEOUT_MS,
	KIOSK_CONFIRMATION_MS,
	KIOSK_IDLE_MS,
	KIOSK_OUTCOME_FIRST_CHECK_MS,
	KIOSK_OUTCOME_RETRY_MS,
} from "./kiosk-timing";

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
 * screens of a turn and how they follow each other are `kiosk-turn-flow.ts`
 * (shown by `KioskTurnScreen`); actions whose reply was lost (#1363) are
 * `useKioskUncertainActions`.
 *
 * A kiosk that accepts badges (#1366) also opens a turn from a badge read on
 * the home screen (`identifyBadge`, fed by the attached scanner through
 * `KioskHome`); the badge then stands in for the PIN for that turn only, online
 * only, and is never stored. Scans anywhere else are swallowed. A kiosk whose
 * camera input is on (#1367) also offers "Scan badge" there: the camera step
 * reads the badge on the device and feeds the same `identifyBadge`; the camera
 * runs only while that step shows.
 *
 * A kiosk whose NFC fob reader is on (#1505) reads kiosk fobs on the home
 * screen too (`identifyFob`, through the same listener). A registered fob
 * selects its employee in place of the name pick and opens their PIN entry
 * (#1506); the PIN still proves and the turn goes on as name-and-PIN clocking.
 * Fobs need a connection, and reads on every other screen are swallowed.
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

	function kioskRefused(code: KioskRefusalCode) {
		if (code === "kiosk_revoked") onRevoked();
		else onUnpaired();
	}

	/**
	 * A newer description of the kiosk. Camera badges (#1367): an admin who
	 * switches the camera input off while the camera step shows closes it.
	 */
	function kioskChanged(next: KioskDeviceInfo) {
		setKiosk(next);
		if (!kioskAcceptsBadgeInput(next, "camera")) {
			setFlow((current) => (current.step === "camera" ? { step: "home" } : current));
		}
		// Fobs (#1505): a reader switched off ends a registration in progress (Z8 would refuse it).
		if (next.nfcFobReaderEnabled !== true) {
			setFlow((current) => (isFobRegistrationStep(current) ? { step: "home" } : current));
		}
	}

	const contact = useKioskOfflineMode({
		token,
		kiosk,
		onKiosk: kioskChanged,
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

	// Actions whose reply was lost, also before a reload or remount (#1363).
	const uncertain = useKioskUncertainActions({
		token,
		kioskId: initialKiosk.id,
		online: contact.online,
		shownFlow,
		show,
		onKioskRefused: kioskRefused,
	});

	const touched = useKioskIdleReturn({ flow, setFlow, onIdle: goHome });

	// Attached-scanner badges (#1366): read on the home screen (`KioskHome`), and kept
	// away from every other screen, so no scan switches or changes an employee's turn.
	// The camera scan screen counts as such a screen too (#1367).
	const scanner = kioskAcceptsBadgeInput(kiosk, "scanner");
	// An attached NFC reader (#1505) types like a scanner: fobs are read on the home
	// screen only, and kept away from every other screen the same way.
	const fobReader = kiosk.nfcFobReaderEnabled === true;
	useKioskBadgeScanner({
		mode: (scanner || fobReader) && flow.step !== "home" ? "guard" : "off",
	});

	// Camera badges (#1367): "Scan badge" on the home screen opens the camera step.
	const camera = kioskAcceptsBadgeInput(kiosk, "camera");

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
		const held =
			checked.step === "employee" ? uncertain.pendingFor(checked.snapshot.employee.id) : undefined;
		if (held && checked.step === "employee") uncertain.hold(held, checked);
		else show(checked);
	}

	/**
	 * A kiosk fob read on the home screen: the employee it selects here, whose
	 * PIN entry opens as after picking their name (#1506), or the offer to
	 * register it (#1505). Fobs need a connection; offline nothing is sent or
	 * queued, and the employee can still tap their name.
	 */
	async function identifyFob(serial: string) {
		if (!contact.online) {
			setFlow({ step: "home", notice: { code: "fob_offline" } });
			return;
		}
		setFlow({ step: "fob" });
		const result = await kioskPost<KioskFobLookup>(
			token,
			"/api/kiosk/fob",
			{ serial },
			{ timeoutMs: KIOSK_ACTION_TIMEOUT_MS },
		);
		if (result.kind === "kiosk") return kioskRefused(result.code);
		const checked = fobCheckedFlow({ serial, result, contactLost: contact.contactLost });
		// Like a name pick: an employee whose action is unresolved gets no PIN pad (#1363).
		const held = checked.step === "pin" ? uncertain.pendingFor(checked.employee.id) : undefined;
		if (held) uncertain.hold(held);
		else show(checked);
	}

	/** Registering a fob (#1505): the employee's name and kiosk PIN link it to them. */
	async function registerFob(
		serial: string,
		employee: KioskEmployeeListing,
		attempt: number,
		pin: string,
	) {
		setFlow({ step: "fob-pin", serial, employee, attempt, busy: true, error: null });
		const result = await kioskPost<KioskFobRegistrationResult>(
			token,
			"/api/kiosk/fob/registration",
			{ serial, employeeId: employee.id, pin },
			{ timeoutMs: KIOSK_ACTION_TIMEOUT_MS },
		);
		if (result.kind === "kiosk") return kioskRefused(result.code);
		show(
			fobRegisteredFlow({ serial, employee, attempt, result, contactLost: contact.contactLost }),
		);
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
		if (acted.step === "uncertain") uncertain.track(attempt);
		else forgetUncertainAction(attempt.operationId);
		show(acted);
	}

	/** An offline action (#1292): frozen and queued on this kiosk, confirmed by Z8 later. */
	async function actOffline(turn: OfflineTurn, action: KioskPanelAction, vehicle?: VehicleAnswer) {
		setFlow(actingOfflineFlow(turn, action, vehicle));
		const failed = t(
			"timeTracking.kiosk.offline.notSaved",
			"This could not be saved on the kiosk. Nothing was recorded.",
		);
		setFlow(await queueOfflineAction({ token, kiosk, turn, action, vehicle, failed }));
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

	/**
	 * An action's button: first the project and work category when an online
	 * clock-out asks them (#887), then the vehicle step when the action asks
	 * vehicle use (#1123). Declared after `proceed`: the React Compiler cannot
	 * compile a call to a function declared later.
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
			onPointerDownCapture={touched}
			onKeyDownCapture={touched}
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
						{...(fobReader ? { onFob: (serial: string) => void identifyFob(serial) } : {})}
						{...(camera ? { onScanBadge: scanWithCamera } : {})}
						onChooseLanguage={language.choose}
						onPick={(employee) => {
							const held = uncertain.pendingFor(employee.id);
							if (held) uncertain.hold(held);
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
					token={token}
					onKioskRefused={kioskRefused}
					onRegisterFob={(serial, employee, attempt, pin) =>
						void registerFob(serial, employee, attempt, pin)
					}
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
