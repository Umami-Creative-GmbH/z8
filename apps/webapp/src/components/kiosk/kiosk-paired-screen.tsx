"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { kioskFetch, kioskPost, kioskRefusalOf } from "@/lib/time-tracking/kiosk/device";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import {
	type KioskContactAnchor,
	type KioskFrozenSubmission,
	parseKioskFrozenSubmission,
	type SealedKioskPin,
} from "@/lib/time-tracking/kiosk/frozen-command";
import type { CachedKioskEmployee } from "@/lib/time-tracking/kiosk/offline-cache";
import { kioskOfflineClock } from "@/lib/time-tracking/kiosk/offline-clock";
import {
	buildKioskOfflineCommand,
	type KioskOfflineEmployeeView,
	kioskOfflineEmployeeView,
} from "@/lib/time-tracking/kiosk/offline-command";
import {
	readOfflineContact,
	readOfflineEmployees,
	rememberKioskContact,
	takeOfflinePinAttempt,
} from "@/lib/time-tracking/kiosk/offline-device";
import {
	frozenCommandOf,
	type KioskQueueNotice,
	kioskOfflineQueue,
} from "@/lib/time-tracking/kiosk/offline-queue";
import { sealKioskPin } from "@/lib/time-tracking/kiosk/pin-seal";
import type {
	KioskClockRefusal,
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskOfflineContact,
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
import { KioskQueueNotices } from "./kiosk-queue-notices";
import { type KioskVehicleQuestion, kioskVehicleQuestion } from "./kiosk-vehicle-use";
import { type KioskVehicleUseAnswer, KioskVehicleUseStep } from "./kiosk-vehicle-use-step";

/** How often a paired kiosk checks in, so revocation shows and "last seen" stays current. */
const KIOSK_HEARTBEAT_MS = 60_000;
/** The confirmation returns home on its own after about this long. */
export const KIOSK_CONFIRMATION_MS = 10_000;
/** A PIN pad or employee screen nobody touches returns home after this long. */
export const KIOSK_IDLE_MS = 30_000;
/** Notices about refused offline clockings disappear on their own after this long. */
const KIOSK_NOTICE_MS = 5 * 60_000;

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

type Confirmation = {
	name: string;
	action: KioskPanelAction;
	at: string;
	zone: string;
	/** Entered vehicle use could not be recorded; the action ran without it (#1123). */
	vehicleUseLeftOut: boolean;
	/** Saved on this kiosk while offline, not yet confirmed by Z8 (#1292). */
	unconfirmed: boolean;
};

/** An action's vehicle question and the context it asks from (#1123). */
type VehicleAsk = { question: KioskVehicleQuestion; context: KioskVehicleUse };

/**
 * An employee's turn at an offline kiosk (#1292): their state as the kiosk
 * believes it, and their PIN sealed for the one command this turn may queue.
 * The plaintext PIN is not kept.
 */
type OfflineTurn = {
	view: KioskOfflineEmployeeView;
	operationId: string;
	pin: SealedKioskPin;
	contact: KioskContactAnchor;
};

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
	| {
			/**
			 * An offline-mode kiosk without a connection that cannot queue (no contact
			 * anchor or sealing key cached yet, #1291): the employee's cached state as of
			 * the instant the server last told it, never a day total, and no actions.
			 */
			step: "cached";
			employee: CachedKioskEmployee;
	  }
	| {
			/** Offline kiosk clocking (#1292): the believed state and actions that queue. */
			step: "offline";
			turn: OfflineTurn;
			pending: KioskPanelAction | null;
			error: string | null;
	  }
	| {
			step: "offline-vehicle";
			turn: OfflineTurn;
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
		unconfirmed: false,
	};
}

/** The kiosk as the server describes it now, from the heartbeat; null when unreadable. */
async function kioskInfoOf(
	response: Response,
): Promise<{ kiosk: KioskDeviceInfo; offline?: KioskOfflineContact } | null> {
	if (!response.ok) return null;
	const body = (await response.json().catch(() => null)) as {
		kiosk?: KioskDeviceInfo;
		offline?: KioskOfflineContact;
	} | null;
	if (!body?.kiosk || typeof body.kiosk.boardEnabled !== "boolean") return null;
	return { kiosk: body.kiosk, ...(body.offline ? { offline: body.offline } : {}) };
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
 * (`offline-queue.ts`) and refusals show as notices on the home screen.
 */
export function KioskPairedScreen({
	token,
	kiosk: pairedKiosk,
	cached = false,
	offline: openingContact,
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
	// Whether the last contact failed; an offline-mode kiosk opened from its cache starts so.
	const [contactLost, setContactLost] = useState(cached);
	// Counts an offline-mode kiosk's successful contacts, so its employee cache refreshes at each.
	const [contacts, setContacts] = useState(0);
	// Whether this kiosk can queue offline: a contact anchor and sealing key are cached (#1292).
	const [canQueue, setCanQueue] = useState(false);
	const [notices, setNotices] = useState<KioskQueueNotice[]>([]);
	const offlineNow = !online || (kiosk.offlineMode && contactLost);

	function kioskRefused(code: KioskRefusalCode) {
		if (code === "kiosk_revoked") onRevoked();
		else onUnpaired();
	}

	function goHome() {
		setFlow({ step: "home" });
		language.reset();
	}

	/** Whether the kiosk can queue offline: a contact anchor and sealing key are cached. */
	async function refreshCanQueue(current: KioskDeviceInfo) {
		setCanQueue(current.offlineMode && (await readOfflineContact(current.id)) !== null);
	}

	/** Sends the queued commands; answers whether any was settled. */
	async function sendQueue(): Promise<boolean> {
		const report = await kioskOfflineQueue.send(token);
		if (report.refused.length > 0) setNotices((shown) => [...shown, ...report.refused]);
		return report.settled > 0;
	}

	const checkIn = useEffectEvent(async () => {
		const response = await kioskFetch(token, "/api/kiosk/session").catch(() => null);
		if (!response) {
			setContactLost(true);
			return;
		}
		const refusal = await kioskRefusalOf(response);
		if (refusal) return kioskRefused(refusal);
		const current = await kioskInfoOf(response);
		if (!current) {
			setContactLost(true);
			return;
		}
		setKiosk(current.kiosk);
		setContactLost(false);
		await rememberKioskContact(current.kiosk, language.locale, current.offline);
		await refreshCanQueue(current.kiosk);
		const settled = await sendQueue();
		if (current.kiosk.offlineMode || settled) setContacts((count) => count + 1);
	});

	// The kiosk the page opened on came from the server: that was a contact too.
	const rememberOpening = useEffectEvent(async () => {
		if (!cached) await rememberKioskContact(pairedKiosk, language.locale, openingContact);
		await refreshCanQueue(pairedKiosk);
		if (cached) return;
		if (await sendQueue()) setContacts((count) => count + 1);
	});

	useEffect(() => {
		void rememberOpening();
		const timer = window.setInterval(() => void checkIn(), KIOSK_HEARTBEAT_MS);
		return () => window.clearInterval(timer);
	}, []);

	// An offline-mode kiosk checks in as soon as the connection is back.
	useEffect(() => {
		if (online && kiosk.offlineMode && contactLost) void checkIn();
	}, [online, kiosk.offlineMode, contactLost]);

	// Notices about refused offline clockings go away on their own after a while.
	useEffect(() => {
		if (notices.length === 0) return;
		const timer = window.setTimeout(() => setNotices([]), KIOSK_NOTICE_MS);
		return () => window.clearTimeout(timer);
	}, [notices]);

	// Every screen of an employee's turn returns home on its own; a touch restarts the wait.
	const returnHome = useEffectEvent(() => goHome());
	const busy =
		(flow.step === "pin" && flow.busy) ||
		(flow.step === "employee" && flow.pending !== null) ||
		(flow.step === "vehicle" && flow.pending) ||
		(flow.step === "offline" && flow.pending !== null) ||
		(flow.step === "offline-vehicle" && flow.pending);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `activity` restarts the idle timer
	useEffect(() => {
		if (flow.step === "home" || busy) return;
		const timeout = flow.step === "done" ? KIOSK_CONFIRMATION_MS : KIOSK_IDLE_MS;
		const timer = window.setTimeout(() => returnHome(), timeout);
		return () => window.clearTimeout(timer);
	}, [flow, busy, activity]);

	/**
	 * An offline PIN entry (#1292): counted against the per-kiosk attempt limit,
	 * sealed for Z8 at once for the one command the turn may queue, and never
	 * checked or kept here. Without a cached anchor and key, the cached state only.
	 */
	async function openOfflineTurn(
		employee: KioskEmployeeListing,
		attempt: number,
		pin: string,
		cachedEmployee: CachedKioskEmployee,
	) {
		const contact = await readOfflineContact(kiosk.id);
		if (!contact) {
			setFlow({ step: "cached", employee: cachedEmployee });
			return;
		}
		const limit = await takeOfflinePinAttempt();
		if (!limit.allowed) {
			setFlow({
				step: "pin",
				employee,
				attempt: attempt + 1,
				busy: false,
				error: { code: "rate_limited", retryAfter: limit.retryAfterSeconds },
			});
			return;
		}
		const operationId = crypto.randomUUID();
		let sealed: SealedKioskPin;
		try {
			sealed = await sealKioskPin(pin, {
				sealingKey: contact.sealingKey,
				kioskId: kiosk.id,
				employeeId: employee.id,
				operationId,
			});
		} catch {
			setFlow({ step: "cached", employee: cachedEmployee });
			return;
		}
		const queued = (await kioskOfflineQueue.commands())
			.filter((record) => record.kioskId === kiosk.id)
			.map(frozenCommandOf);
		setFlow({
			step: "offline",
			turn: {
				view: kioskOfflineEmployeeView(cachedEmployee, queued),
				operationId,
				pin: sealed,
				contact: contact.contact,
			},
			pending: null,
			error: null,
		});
	}

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
		if (result.kind === "offline" && kiosk.offlineMode) {
			const cachedEmployee = (await readOfflineEmployees(kiosk.id))?.find(
				(candidate) => candidate.id === employee.id,
			);
			if (cachedEmployee) return openOfflineTurn(employee, attempt, pin, cachedEmployee);
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

	/** The submission an offline action freezes; vehicle use Z8 would not read is left out. */
	function offlineSubmission(
		turn: OfflineTurn,
		action: KioskPanelAction,
		answer: KioskVehicleUseAnswer | undefined,
	): { submission: KioskFrozenSubmission; vehicleUseLeftOut: boolean } | null {
		const { occurredAt, timeSource } = kioskOfflineClock.now();
		const build = (withVehicleUse: boolean) => {
			const command = buildKioskOfflineCommand({
				view: turn.view,
				action,
				operationId: turn.operationId,
				kioskId: kiosk.id,
				timezone: kiosk.timezone,
				occurredAt,
				timeSource,
				...(withVehicleUse && answer?.vehicleUse ? { vehicleUse: answer.vehicleUse } : {}),
			});
			if (!command) return null;
			const submission = { command, pin: turn.pin, contact: turn.contact };
			return parseKioskFrozenSubmission(submission).ok ? submission : null;
		};
		const full = build(true);
		if (full) return { submission: full, vehicleUseLeftOut: answer?.leftOut ?? false };
		const without = answer?.vehicleUse ? build(false) : null;
		return without ? { submission: without, vehicleUseLeftOut: true } : null;
	}

	/** An offline action (#1292): frozen and queued on this kiosk, confirmed by Z8 later. */
	async function actOffline(
		turn: OfflineTurn,
		action: KioskPanelAction,
		vehicle?: { ask: VehicleAsk; answer: KioskVehicleUseAnswer },
	) {
		setFlow(
			vehicle
				? { step: "offline-vehicle", turn, action, ask: vehicle.ask, pending: true }
				: { step: "offline", turn, pending: action, error: null },
		);
		const frozen = offlineSubmission(turn, action, vehicle?.answer);
		const failed = t(
			"timeTracking.kiosk.offline.notSaved",
			"This could not be saved on the kiosk. Nothing was recorded.",
		);
		if (!frozen) {
			setFlow({ step: "offline", turn, pending: null, error: failed });
			return;
		}
		try {
			await kioskOfflineQueue.enqueue({
				submission: frozen.submission,
				employeeName: turn.view.employee.name,
				action,
			});
		} catch {
			setFlow({ step: "offline", turn, pending: null, error: failed });
			return;
		}
		const { command } = frozen.submission;
		setFlow({
			step: "done",
			confirmation: {
				name: turn.view.employee.name,
				action,
				// A day ended on a break ends at the break's start.
				at: action === "end_day" ? (turn.view.endsDayAt ?? command.occurredAt) : command.occurredAt,
				zone: kiosk.timezone,
				vehicleUseLeftOut: frozen.vehicleUseLeftOut,
				unconfirmed: true,
			},
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

	function chooseOffline(turn: OfflineTurn, action: KioskPanelAction) {
		const context = turn.view.vehicleUse;
		const question = kioskVehicleQuestion(action, context);
		if (question && context) {
			const ask = { question, context };
			setFlow({ step: "offline-vehicle", turn, action, ask, pending: false });
			return;
		}
		void actOffline(turn, action);
	}

	const queuedNotice = (view: KioskOfflineEmployeeView) =>
		view.queued > 0
			? t(
					"timeTracking.kiosk.offline.stateQueued",
					"The kiosk is offline. This includes clockings saved on this kiosk that are not yet confirmed.",
				)
			: t(
					"timeTracking.kiosk.offline.stateNote",
					"The kiosk is offline. What you do now is saved on this kiosk and not yet confirmed.",
				);

	return (
		<div
			className="flex flex-1 flex-col gap-4"
			onPointerDownCapture={() => setActivity((count) => count + 1)}
			onKeyDownCapture={() => setActivity((count) => count + 1)}
		>
			{offlineNow ? (
				<div
					role="alert"
					className="flex items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100"
				>
					<IconWifiOff className="size-6 shrink-0" aria-hidden="true" />
					{kiosk.offlineMode && canQueue
						? t(
								"timeTracking.kiosk.offline.queueBanner",
								"The kiosk is offline. Clockings are saved on this kiosk and confirmed when the connection is back.",
							)
						: t(
								"timeTracking.kiosk.offline.banner",
								"The kiosk is offline. Clocking is not possible until the connection is back.",
							)}
				</div>
			) : null}
			{flow.step === "home" ? (
				<>
					<KioskQueueNotices
						notices={notices}
						zone={kiosk.timezone}
						locale={language.locale}
						onDismiss={() => setNotices([])}
					/>
					<KioskHome
						token={token}
						kiosk={kiosk}
						contacts={contacts}
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
			) : null}
			{flow.step === "pin" ? (
				<KioskPinPad
					key={flow.attempt}
					name={flow.employee.name}
					busy={flow.busy}
					disabled={!online && !kiosk.offlineMode}
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
			{flow.step === "cached" ? (
				<KioskEmployeePanel
					snapshot={{
						employee: { id: flow.employee.id, name: flow.employee.name },
						state: flow.employee.state,
						asOf: flow.employee.learnedAt,
					}}
					zone={kiosk.timezone}
					locale={language.locale}
					pending={null}
					disabled
					error={null}
					onAction={() => undefined}
					onBack={goHome}
				/>
			) : null}
			{flow.step === "offline" ? (
				<KioskEmployeePanel
					snapshot={{
						employee: flow.turn.view.employee,
						state: flow.turn.view.state,
						asOf: flow.turn.view.learnedAt,
					}}
					zone={kiosk.timezone}
					locale={language.locale}
					pending={flow.pending}
					disabled={false}
					error={flow.error}
					notice={queuedNotice(flow.turn.view)}
					onAction={(action) => chooseOffline(flow.turn, action)}
					onBack={goHome}
				/>
			) : null}
			{flow.step === "offline-vehicle" ? (
				<KioskVehicleUseStep
					question={flow.ask.question}
					snapshot={flow.turn.view}
					context={flow.ask.context}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={false}
					onConfirm={(answer) => void actOffline(flow.turn, flow.action, { ask: flow.ask, answer })}
					onBack={() => setFlow({ step: "offline", turn: flow.turn, pending: null, error: null })}
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
