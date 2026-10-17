import type { KioskTimeSource } from "../clocking/types";
import {
	type BreakVehicleUse,
	breakVehicleUse,
	type ClockVehicleUse,
	clockInVehicleUse,
	clockOutVehicleUse,
} from "../vehicle-use/clock-vehicle-use";
import { organizationVehicleIdOf, type WorkVehicleUse } from "../vehicle-use/work-vehicle-use";
import {
	KIOSK_FROZEN_COMMAND_VERSION,
	type KioskContactAnchor,
	type KioskFrozenCommand,
	type KioskFrozenSubmission,
	parseKioskFrozenSubmission,
	type SealedKioskPin,
} from "./frozen-command";
import { allowedFrom, type KioskAction } from "./kiosk-actions";
import type { CachedKioskEmployee } from "./offline-cache";
import type { KioskEmployeeState, KioskVehicleUse } from "./protocol";

/**
 * An employee's turn at an offline kiosk (#1292, spec #885, ADR 0011): what the
 * kiosk shows (the cached state with its own queued commands on top) and the
 * frozen command each action becomes (`frozen-command.ts`, version 1). Pure and
 * client-safe.
 */

/** The work a clock-out closes: a known period, or the one the kiosk's own queued command started. */
type CloseTarget = { workPeriodId: string } | { clockInOperationId: string };

export type KioskOfflineEmployeeView = {
	employee: { id: string; name: string };
	/** The state as the kiosk believes it: the cached one, then its own queued commands. */
	state: KioskEmployeeState;
	/** When the server last told the kiosk the employee's state (UTC ISO). */
	learnedAt: string;
	/** How many of the employee's commands wait on this kiosk, not yet confirmed by Z8. */
	queued: number;
	/** The work a clock-out closes; null while clocked out. */
	closes: CloseTarget | null;
	/** The break a resume ends, as the kiosk believes it started; null unless on a break. */
	breakStart: { at: string; timezone: string } | null;
	/** When ending the day now ends the work (the break's start); null unless on a break. */
	endsDayAt: string | null;
	/** The vehicle use the kiosk asks (cached at the last contact, #1123); absent asks nothing. */
	vehicleUse?: KioskVehicleUse;
};

type Believed = {
	state: KioskEmployeeState;
	closes: CloseTarget | null;
	breakStart: { at: string; timezone: string } | null;
	vehicleUse?: KioskVehicleUse;
};

function believedFromCache(employee: CachedKioskEmployee): Believed {
	const { state } = employee;
	return {
		state,
		closes: state.status === "clocked_out" ? null : { workPeriodId: state.workPeriodId },
		breakStart:
			state.status === "on_break" ? { at: state.breakSince, timezone: state.breakZone } : null,
		...(employee.vehicleUse ? { vehicleUse: employee.vehicleUse } : {}),
	};
}

/** The vehicle context with the live work's vehicle use replaced, and a closed work's end reading kept. */
function withLive(
	context: KioskVehicleUse | undefined,
	live: WorkVehicleUse | null,
	closed?: WorkVehicleUse | null,
): KioskVehicleUse | undefined {
	if (!context) return undefined;
	const closedVehicle = organizationVehicleIdOf(closed ?? null);
	const lastEndKmByVehicleId =
		closedVehicle && closed?.endKm != null
			? { ...context.lastEndKmByVehicleId, [closedVehicle]: closed.endKm }
			: context.lastEndKmByVehicleId;
	return { ...context, live, lastEndKmByVehicleId };
}

function isClockVehicleUse(value: unknown): value is ClockVehicleUse {
	return typeof value === "object" && value !== null && !("readingKm" in value);
}

/** What the employee pressed for a frozen command, given the state it followed. */
function pressedFor(command: KioskFrozenCommand, state: KioskEmployeeState): KioskAction {
	return command.action === "clock_out" && state.status === "on_break" ? "end_day" : command.action;
}

/** One queued command applied to what the kiosk believes; null when the state does not allow it. */
function applied(believed: Believed, command: KioskFrozenCommand): Believed | null {
	const { state } = believed;
	if (!allowedFrom(state, pressedFor(command, state))) return null;
	switch (command.action) {
		case "clock_in":
			return {
				state: {
					status: "clocked_in",
					workPeriodId: command.operationId,
					since: command.occurredAt,
				},
				closes: { clockInOperationId: command.operationId },
				breakStart: null,
				vehicleUse: withLive(believed.vehicleUse, clockInVehicleUse(command.vehicleUse)),
			};
		case "start_break":
			// Always true here (`allowedFrom`); it narrows the state for the spread below.
			if (state.status !== "clocked_in") return null;
			return {
				...believed,
				state: {
					...state,
					status: "on_break",
					breakSince: command.occurredAt,
					breakZone: command.timezone,
				},
				breakStart: { at: command.occurredAt, timezone: command.timezone },
			};
		case "resume_break": {
			const live = believed.vehicleUse?.live ?? null;
			const { closed, resumed } = breakVehicleUse(live, command.vehicleUse);
			return {
				state: {
					status: "clocked_in",
					workPeriodId: command.operationId,
					since: command.occurredAt,
				},
				closes: { clockInOperationId: command.operationId },
				breakStart: null,
				vehicleUse: withLive(believed.vehicleUse, resumed, closed),
			};
		}
		case "clock_out": {
			const closed = clockOutVehicleUse(believed.vehicleUse?.live ?? null, command.vehicleUse);
			return {
				state: { status: "clocked_out" },
				closes: null,
				breakStart: null,
				vehicleUse: withLive(believed.vehicleUse, null, closed),
			};
		}
	}
}

/**
 * The employee as an offline kiosk shows them: their cached state, then the
 * kiosk's own commands for them in queue order, those Z8 already confirmed
 * (until a cached state learned after them arrives) and those still queued. A
 * command the state does not allow is skipped (the cache may already show it).
 */
export function kioskOfflineEmployeeView(
	employee: CachedKioskEmployee,
	queued: readonly KioskFrozenCommand[],
	options: { confirmed?: ReadonlySet<string> } = {},
): KioskOfflineEmployeeView {
	let believed = believedFromCache(employee);
	const own = queued.filter((command) => command.employeeId === employee.id);
	for (const command of own) believed = applied(believed, command) ?? believed;
	const { vehicleUse, ...rest } = believed;
	return {
		employee: { id: employee.id, name: employee.name },
		learnedAt: employee.learnedAt,
		queued: own.filter((command) => !options.confirmed?.has(command.operationId)).length,
		...rest,
		endsDayAt: believed.state.status === "on_break" ? believed.state.breakSince : null,
		...(vehicleUse ? { vehicleUse } : {}),
	};
}

export type KioskOfflineCommandInput = {
	view: KioskOfflineEmployeeView;
	action: KioskAction;
	/** Made once, before the PIN is sealed for it. */
	operationId: string;
	kioskId: string;
	/** The kiosk's zone as cached. */
	timezone: string;
	occurredAt: string;
	timeSource: KioskTimeSource;
	vehicleUse?: ClockVehicleUse | BreakVehicleUse;
};

/**
 * The frozen command an action becomes, or null when the employee's state does
 * not allow it. Absent fields are omitted, never null.
 */
export function buildKioskOfflineCommand(
	input: KioskOfflineCommandInput,
): KioskFrozenCommand | null {
	const { view, action, vehicleUse } = input;
	const base = {
		version: KIOSK_FROZEN_COMMAND_VERSION as KioskFrozenCommand["version"],
		operationId: input.operationId,
		kioskId: input.kioskId,
		employeeId: view.employee.id,
		occurredAt: input.occurredAt,
		timeSource: input.timeSource,
		timezone: input.timezone,
	};
	if (!allowedFrom(view.state, action)) return null;
	switch (action) {
		case "clock_in": {
			const use =
				isClockVehicleUse(vehicleUse) && vehicleUse.vehicle
					? {
							vehicle: vehicleUse.vehicle,
							...(vehicleUse.startKm === undefined ? {} : { startKm: vehicleUse.startKm }),
						}
					: undefined;
			return {
				...base,
				action: "clock_in",
				workLocationType: "office",
				...(use ? { vehicleUse: use } : {}),
			};
		}
		case "start_break":
			return { ...base, action: "start_break" };
		case "resume_break": {
			if (!view.breakStart) return null;
			const use =
				vehicleUse && "readingKm" in vehicleUse ? { readingKm: vehicleUse.readingKm } : undefined;
			return {
				...base,
				action: "resume_break",
				breakStart: view.breakStart,
				...(use ? { vehicleUse: use } : {}),
			};
		}
		case "clock_out":
		case "end_day": {
			if (!view.closes) return null;
			const use =
				isClockVehicleUse(vehicleUse) && Object.keys(vehicleUse).length > 0
					? vehicleUse
					: undefined;
			return {
				...base,
				action: "clock_out",
				target: view.closes,
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
				...(use ? { vehicleUse: use } : {}),
			};
		}
	}
}

/** What the employee answered at the vehicle step, if it asked (#1123). */
export type KioskOfflineVehicleAnswer = {
	vehicleUse?: ClockVehicleUse | BreakVehicleUse;
	/** Entered vehicle use that cannot be recorded; the action runs without it. */
	leftOut: boolean;
};

/**
 * The submission an offline action freezes (#1292): the frozen command with the
 * PIN sealed at PIN entry and the contact anchor, exactly as Z8 will parse it.
 * Vehicle use Z8 would not read is left out (and said so) rather than losing
 * the clocking. Null when the employee's state does not allow the action.
 */
export function freezeKioskOfflineSubmission(
	input: Omit<KioskOfflineCommandInput, "vehicleUse"> & {
		pin: SealedKioskPin;
		contact: KioskContactAnchor;
		answer?: KioskOfflineVehicleAnswer;
	},
): { submission: KioskFrozenSubmission; vehicleUseLeftOut: boolean } | null {
	const { pin, contact, answer, ...command } = input;
	const build = (vehicleUse: ClockVehicleUse | BreakVehicleUse | undefined) => {
		const frozen = buildKioskOfflineCommand({ ...command, ...(vehicleUse ? { vehicleUse } : {}) });
		if (!frozen) return null;
		const submission: KioskFrozenSubmission = { command: frozen, pin, contact };
		return parseKioskFrozenSubmission(submission).ok ? submission : null;
	};
	const full = build(answer?.vehicleUse);
	if (full) return { submission: full, vehicleUseLeftOut: answer?.leftOut ?? false };
	const without = answer?.vehicleUse ? build(undefined) : null;
	return without ? { submission: without, vehicleUseLeftOut: true } : null;
}
