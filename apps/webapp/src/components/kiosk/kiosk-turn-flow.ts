import { isKioskCallUnreachable, type KioskCallResult } from "@/lib/time-tracking/kiosk/device";
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
	KioskClockRefusal,
	KioskClockResult,
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
	KioskVehicleUse,
} from "@/lib/time-tracking/kiosk/protocol";
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

export type KioskFlow =
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
	| { step: "done"; confirmation: KioskTurnConfirmation };

/** A kiosk call's answer other than a refused device token, which ends the kiosk's session. */
type AnsweredCall<T> = Exclude<KioskCallResult<T>, { kind: "kiosk" }>;

/** Whether the turn waits on a call or the queue; a busy turn does not return home on its own. */
export function isKioskFlowBusy(flow: KioskFlow): boolean {
	switch (flow.step) {
		case "pin":
			return flow.busy;
		case "employee":
		case "offline":
			return flow.pending !== null;
		case "vehicle":
		case "offline-vehicle":
			return flow.pending;
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
			pin,
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

/** The screen while an online action is sent: the vehicle step or the employee panel, pending. */
export function actingFlow(
	pin: string,
	snapshot: KioskEmployeeSnapshot,
	action: KioskPanelAction,
	vehicle?: VehicleAnswer,
): KioskFlow {
	return vehicle
		? {
				step: "vehicle",
				pin,
				snapshot,
				action,
				ask: vehicle.ask,
				pending: true,
			}
		: { step: "employee", pin, snapshot, pending: action, error: null };
}

/**
 * The screen after an online action: the confirmation, the PIN pad again when
 * Z8 refused the PIN, or the employee panel with the refusal (and the state Z8
 * reported with it).
 */
export function actedFlow(input: {
	pin: string;
	snapshot: KioskEmployeeSnapshot;
	action: KioskPanelAction;
	vehicle?: VehicleAnswer;
	result: AnsweredCall<KioskClockResult>;
}): KioskFlow {
	const { pin, snapshot, action, result } = input;
	if (result.kind === "ok") {
		return {
			step: "done",
			confirmation: confirmationOf(action, result.body, input.vehicle?.answer.leftOut ?? false),
		};
	}
	if (result.kind === "refused" && KIOSK_PIN_REFUSALS.has(result.refusal.code)) {
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
		pin,
		snapshot: after,
		pending: null,
		error: refusal,
	};
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
