import {
	isKioskCallUncertain,
	isKioskCallUnreachable,
	type KioskCallResult,
} from "@/lib/time-tracking/kiosk/device";
import type { KioskContactAnchor, SealedKioskPin } from "@/lib/time-tracking/kiosk/frozen-command";
import type { CachedKioskEmployee } from "@/lib/time-tracking/kiosk/offline-cache";
import { kioskOfflineClock } from "@/lib/time-tracking/kiosk/offline-clock";
import {
	freezeKioskOfflineSubmission,
	type KioskOfflineEmployeeView,
	kioskOfflineEmployeeView,
} from "@/lib/time-tracking/kiosk/offline-command";
import {
	readOfflineContact,
	readOfflineEmployees,
	takeOfflinePinAttempt,
} from "@/lib/time-tracking/kiosk/offline-device";
import { frozenCommandsOf, kioskOfflineQueue } from "@/lib/time-tracking/kiosk/offline-queue";
import { sealKioskPin } from "@/lib/time-tracking/kiosk/pin-seal";
import type {
	KioskClockAttemptOutcome,
	KioskClockRefusal,
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskVehicleUse,
} from "@/lib/time-tracking/kiosk/protocol";
import type { KioskUncertainAction } from "@/lib/time-tracking/kiosk/uncertain-action";
import type { KioskPanelAction } from "./kiosk-employee-panel";
import { KIOSK_PIN_REFUSALS } from "./kiosk-messages";
import { type KioskVehicleQuestion, kioskVehicleQuestion } from "./kiosk-vehicle-use";
import type { KioskVehicleUseAnswer } from "./kiosk-vehicle-use-step";

/**
 * One employee's turn at a paired kiosk (#862, #1123, #1291, #1292): which
 * screen shows, and what the next screen is once a call or the offline queue
 * answers. The kiosk screen keeps the `KioskFlow` in its state.
 */

export type KioskTurnConfirmation = {
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
export type VehicleAsk = {
	question: KioskVehicleQuestion;
	context: KioskVehicleUse;
};

/** The vehicle step's answer, with the question it answered (#1123). */
export type VehicleAnswer = { ask: VehicleAsk; answer: KioskVehicleUseAnswer };

/**
 * An employee's turn at an offline kiosk (#1292): their state as the kiosk
 * believes it, and their PIN sealed for the one command this turn may queue.
 * The plaintext PIN is not kept.
 */
export type OfflineTurn = {
	view: KioskOfflineEmployeeView;
	operationId: string;
	pin: SealedKioskPin;
	contact: KioskContactAnchor;
};

/**
 * What proves the employee on an online turn: the PIN they entered, or (#1366)
 * the kiosk badge they scanned. Kept only in the turn's state and sent with each
 * call; never stored on the device.
 */
export type KioskTurnProof = { pin: string; badge?: never } | { badge: string; pin?: never };

/** The proof's part of a kiosk call's body. */
export function kioskProofBody(proof: KioskTurnProof, employeeId: string) {
	return proof.badge === undefined
		? { employeeId, pin: proof.pin }
		: { employeeId, badge: proof.badge };
}

/**
 * Why the home screen shows a note (#1366): a badge scan that did not open a
 * turn, or a badge turn that ended without its action. Never names anyone.
 */
export type KioskHomeNotice =
	| {
			code:
				| "badge_not_accepted"
				| "badge_input_disabled"
				| "badge_unreadable"
				| "badge_offline"
				| "badge_failed"
				| "badge_not_recorded";
	  }
	| { code: "badge_rate_limited"; retryAfter: number };

/** Refusals of a badge call: the turn (if any) ends and the home screen says why. */
const KIOSK_BADGE_REFUSALS: ReadonlySet<string> = new Set([
	"badge_not_accepted",
	"badge_input_disabled",
	"rate_limited",
]);

function badgeRefusalNotice(refusal: KioskClockRefusal): KioskHomeNotice {
	if (refusal.code === "rate_limited") {
		return {
			code: "badge_rate_limited",
			retryAfter:
				"retryAfter" in refusal && typeof refusal.retryAfter === "number" ? refusal.retryAfter : 60,
		};
	}
	return {
		code: refusal.code === "badge_input_disabled" ? "badge_input_disabled" : "badge_not_accepted",
	};
}

export type KioskFlow =
	| { step: "home"; notice?: KioskHomeNotice }
	| {
			step: "pin";
			employee: KioskEmployeeListing;
			attempt: number;
			busy: boolean;
			error: KioskClockRefusal | "offline" | null;
	  }
	| {
			/** A scanned badge is being checked (#1366); nothing is shown about anyone yet. */
			step: "badge";
	  }
	| {
			step: "employee";
			proof: KioskTurnProof;
			snapshot: KioskEmployeeSnapshot;
			pending: KioskPanelAction | null;
			error: KioskClockRefusal | "offline" | null;
	  }
	| {
			/** Vehicle use asked between the action's button and the action (#1123). */
			step: "vehicle";
			proof: KioskTurnProof;
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
	| {
			/**
			 * An online action whose reply was lost (#1363): the kiosk asks Z8 what
			 * became of it and offers nothing to do until Z8 answers. `checking` until a
			 * question fails, then `unavailable`; `conflict` when Z8 recorded the
			 * operation for another employee or action and the kiosk cannot tell more.
			 */
			step: "uncertain";
			attempt: KioskUncertainAction;
			check: "checking" | "unavailable" | "conflict";
	  }
	| { step: "done"; confirmation: KioskTurnConfirmation };

/** A kiosk call's answer other than a refused device token, which ends the kiosk's session. */
type AnsweredCall<T> = Exclude<KioskCallResult<T>, { kind: "kiosk" }>;

/** Whether the turn waits on a call or the queue; a busy turn does not return home on its own. */
export function isKioskFlowBusy(flow: KioskFlow): boolean {
	switch (flow.step) {
		case "pin":
			return flow.busy;
		case "badge":
			return true;
		case "employee":
		case "offline":
			return flow.pending !== null;
		case "vehicle":
		case "offline-vehicle":
			return flow.pending;
		case "uncertain":
			// An unresolved action holds the screen; only a conflict may time out.
			return flow.check !== "conflict";
		default:
			return false;
	}
}

/** The vehicle question an action asks first, when it asks one (#1123). */
export function vehicleAskOf(
	action: KioskPanelAction,
	context: KioskVehicleUse | undefined,
): VehicleAsk | null {
	const question = kioskVehicleQuestion(action, context);
	return question && context ? { question, context } : null;
}

/**
 * What a confirmation shows: the time the server recorded for the action (a
 * day ended on a break ends at the break's start), never the device's clock.
 */
function confirmationOf(
	action: KioskPanelAction,
	after: KioskClockResult,
	vehicleUseLeftOut: boolean,
): KioskTurnConfirmation {
	return {
		name: after.employee.name,
		action,
		at: after.at.instant,
		zone: after.at.zone,
		vehicleUseLeftOut,
		unconfirmed: false,
	};
}

/**
 * An offline PIN entry (#1292): counted against the per-kiosk attempt limit,
 * sealed for Z8 at once for the one command the turn may queue, and never
 * checked or kept here. Without a cached anchor and key, the cached state only.
 */
async function offlineTurnFlow(
	kiosk: KioskDeviceInfo,
	employee: KioskEmployeeListing,
	attempt: number,
	pin: string,
	cachedEmployee: CachedKioskEmployee,
): Promise<KioskFlow> {
	const contact = await readOfflineContact(kiosk.id);
	if (!contact) return { step: "cached", employee: cachedEmployee };
	const limit = await takeOfflinePinAttempt();
	if (!limit.allowed) {
		return {
			step: "pin",
			employee,
			attempt: attempt + 1,
			busy: false,
			error: { code: "rate_limited", retryAfter: limit.retryAfterSeconds },
		};
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
		return { step: "cached", employee: cachedEmployee };
	}
	// Commands Z8 confirmed stay applied until a cached state learned after them arrives.
	const [confirmed, queued] = await Promise.all([
		kioskOfflineQueue.confirmed(),
		kioskOfflineQueue.commands(),
	]);
	const own = [...confirmed, ...queued]
		.filter((record) => record.kioskId === kiosk.id)
		.sort((a, b) => a.sequence - b.sequence);
	return {
		step: "offline",
		turn: {
			view: kioskOfflineEmployeeView(cachedEmployee, frozenCommandsOf(own), {
				confirmed: new Set(confirmed.map((record) => record.operationId)),
			}),
			operationId,
			pin: sealed,
			contact: contact.contact,
		},
		pending: null,
		error: null,
	};
}

/**
 * The screen after a PIN check: the employee's state, an offline turn when an
 * offline-mode kiosk does not reach Z8 (no network, or a server or portal that is
 * not Z8 answering), or the PIN pad again with the refusal.
 */
export async function pinCheckedFlow(input: {
	kiosk: KioskDeviceInfo;
	employee: KioskEmployeeListing;
	attempt: number;
	pin: string;
	result: AnsweredCall<KioskEmployeeSnapshot>;
	/** A call found Z8 unreachable while the browser had a network. */
	contactLost: () => void;
}): Promise<KioskFlow> {
	const { kiosk, employee, attempt, pin, result } = input;
	if (result.kind === "ok") {
		return {
			step: "employee",
			proof: { pin },
			snapshot: result.body,
			pending: null,
			error: null,
		};
	}
	if (kiosk.offlineMode && isKioskCallUnreachable(result)) {
		if (result.kind !== "offline") input.contactLost();
		const cachedEmployee = (await readOfflineEmployees(kiosk.id))?.find(
			(candidate) => candidate.id === employee.id,
		);
		if (cachedEmployee) return offlineTurnFlow(kiosk, employee, attempt, pin, cachedEmployee);
	}
	return {
		step: "pin",
		employee,
		attempt: attempt + 1,
		busy: false,
		error: result.kind === "offline" ? "offline" : result.refusal,
	};
}

/**
 * The screen after a badge scan's check (#1366): the badge's employee with
 * their state, day total and actions, or the home screen again with why not.
 * Badge clocking needs a connection: an unreachable Z8 never opens an offline
 * turn, and nothing is queued. Identification itself recorded nothing.
 */
export function badgeCheckedFlow(input: {
	badge: string;
	result: AnsweredCall<KioskEmployeeSnapshot>;
	/** A call found Z8 unreachable while the browser had a network. */
	contactLost: () => void;
}): KioskFlow {
	const { result } = input;
	if (result.kind === "ok") {
		return {
			step: "employee",
			proof: { badge: input.badge },
			snapshot: result.body,
			pending: null,
			error: null,
		};
	}
	if (result.kind === "refused" && KIOSK_BADGE_REFUSALS.has(result.refusal.code)) {
		return { step: "home", notice: badgeRefusalNotice(result.refusal) };
	}
	if (isKioskCallUnreachable(result) && result.kind !== "offline") input.contactLost();
	return {
		step: "home",
		notice: { code: result.kind === "offline" && !result.sent ? "badge_offline" : "badge_failed" },
	};
}

/** The screen while an online action is sent: the vehicle step or the employee panel, pending. */
export function actingFlow(
	proof: KioskTurnProof,
	snapshot: KioskEmployeeSnapshot,
	action: KioskPanelAction,
	vehicle?: VehicleAnswer,
): KioskFlow {
	return vehicle
		? {
				step: "vehicle",
				proof,
				snapshot,
				action,
				ask: vehicle.ask,
				pending: true,
			}
		: { step: "employee", proof, snapshot, pending: action, error: null };
}

/**
 * The screen after an online action: the confirmation, the uncertain step when
 * the reply leaves open whether Z8 recorded it (#1363), the PIN pad again when
 * Z8 refused the PIN, the home screen with why when Z8 no longer accepts the
 * badge (#1366), or the employee panel with the refusal (and the state Z8
 * reported with it). Only a call that was never sent says the kiosk is offline.
 */
export function actedFlow(input: {
	proof: KioskTurnProof;
	snapshot: KioskEmployeeSnapshot;
	action: KioskPanelAction;
	attempt: KioskUncertainAction;
	vehicle?: VehicleAnswer;
	result: AnsweredCall<KioskClockResult>;
}): KioskFlow {
	const { proof, snapshot, action, result } = input;
	if (result.kind === "ok") {
		return {
			step: "done",
			confirmation: confirmationOf(action, result.body, input.vehicle?.answer.leftOut ?? false),
		};
	}
	if (isKioskCallUncertain(result)) {
		return { step: "uncertain", attempt: input.attempt, check: "checking" };
	}
	if (proof.badge !== undefined) {
		if (result.kind === "refused" && KIOSK_BADGE_REFUSALS.has(result.refusal.code)) {
			return { step: "home", notice: badgeRefusalNotice(result.refusal) };
		}
	} else if (result.kind === "refused" && KIOSK_PIN_REFUSALS.has(result.refusal.code)) {
		const employee = { id: snapshot.employee.id, name: snapshot.employee.name };
		return {
			step: "pin",
			employee,
			attempt: 1,
			busy: false,
			error: result.refusal,
		};
	}
	const refusal = result.kind === "offline" ? "offline" : result.refusal;
	const after =
		refusal !== "offline" && "state" in refusal && refusal.state && refusal.dayTotal
			? { ...snapshot, state: refusal.state, dayTotal: refusal.dayTotal }
			: snapshot;
	return {
		step: "employee",
		proof,
		snapshot: after,
		pending: null,
		error: refusal,
	};
}

/**
 * The screen after asking what became of an uncertain action (#1363): its
 * original confirmation once, when Z8 recorded it; the PIN pad for a fresh,
 * explicit action once Z8 has closed it as not recorded; otherwise still
 * uncertain. Never the old action again.
 */
export function resolvedFlow(
	attempt: KioskUncertainAction,
	result: AnsweredCall<KioskClockAttemptOutcome>,
): KioskFlow {
	if (result.kind !== "ok") return { step: "uncertain", attempt, check: "unavailable" };
	const answer = result.body;
	if (answer.outcome === "committed") {
		return {
			step: "done",
			confirmation: {
				name: attempt.employee.name,
				action: attempt.action,
				at: answer.at.instant,
				zone: answer.at.zone,
				vehicleUseLeftOut: false,
				unconfirmed: false,
			},
		};
	}
	if (answer.outcome === "not_recorded") {
		// The badge left with the turn (#1366): a fresh action starts with a new scan or the PIN.
		if (attempt.via === "badge") return { step: "home", notice: { code: "badge_not_recorded" } };
		return {
			step: "pin",
			employee: attempt.employee,
			attempt: 0,
			busy: false,
			error: { code: "not_recorded" },
		};
	}
	if (answer.outcome === "conflict") return { step: "uncertain", attempt, check: "conflict" };
	return { step: "uncertain", attempt, check: "unavailable" };
}

/** The screen while an offline action is queued: the vehicle step or the employee panel, pending. */
export function actingOfflineFlow(
	turn: OfflineTurn,
	action: KioskPanelAction,
	vehicle?: VehicleAnswer,
): KioskFlow {
	return vehicle
		? { step: "offline-vehicle", turn, action, ask: vehicle.ask, pending: true }
		: { step: "offline", turn, pending: action, error: null };
}

/**
 * An offline action (#1292): frozen and queued on this kiosk, confirmed by Z8
 * later. Answers the confirmation, or the employee panel with `failed` when it
 * could not be saved.
 */
export async function queueOfflineAction(input: {
	token: string;
	kiosk: KioskDeviceInfo;
	turn: OfflineTurn;
	action: KioskPanelAction;
	vehicle?: VehicleAnswer;
	/** The message shown when nothing could be saved. */
	failed: string;
}): Promise<KioskFlow> {
	const { kiosk, turn, action, vehicle } = input;
	const notSaved: KioskFlow = {
		step: "offline",
		turn,
		pending: null,
		error: input.failed,
	};
	const frozen = freezeKioskOfflineSubmission({
		view: turn.view,
		action,
		operationId: turn.operationId,
		kioskId: kiosk.id,
		timezone: kiosk.timezone,
		...kioskOfflineClock.now(),
		pin: turn.pin,
		contact: turn.contact,
		...(vehicle ? { answer: vehicle.answer } : {}),
	});
	if (!frozen) return notSaved;
	try {
		await kioskOfflineQueue.enqueue({
			submission: frozen.submission,
			employeeName: turn.view.employee.name,
			action,
			token: input.token,
		});
	} catch {
		return notSaved;
	}
	const { command } = frozen.submission;
	return {
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
	};
}
