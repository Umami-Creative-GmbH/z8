import type { KioskAction } from "./kiosk-actions";
import { KIOSK_CLOCK_ACTIONS, type KioskClockAction } from "./protocol";

/**
 * The online kiosk actions the device is waiting to hear about (#1363, spec
 * #889): what names each attempt, so that a lost reply, a reload or a remount
 * resolves the same operation instead of making a second one. Stored in
 * `localStorage` before the action is sent and removed once Z8 answered it and
 * the answer was shown.
 *
 * An unresolved action holds only its own employee (user decision 2026-10-17):
 * the kiosk keeps checking in the background while everyone else clocks, so
 * several can be waiting at once, one per operation.
 *
 * A record holds no PIN, no badge and no command: nothing in it can run the
 * action again. Client-safe; storage that throws keeps nothing (the page's own
 * state still holds the attempts until they are resolved).
 */
export type KioskUncertainAction = {
	version: 1;
	kioskId: string;
	operationId: string;
	employee: { id: string; name: string };
	/** What the employee pressed, as the confirmation names it. */
	action: KioskAction;
	/** The action as it was sent (`end_day` sends `clock_out`). */
	request: KioskClockAction;
	/**
	 * Set when a kiosk badge proved the employee (#1366): the badge is gone with
	 * the turn, so after a definitive `not_recorded` the employee scans again
	 * (or uses their PIN) to choose a fresh action. Absent for a PIN turn.
	 */
	via?: "badge";
	/** The vehicle use the employee entered was left out of the action as sent (#1123). */
	vehicleUseLeftOut?: true;
	/**
	 * What Z8 answered while the employee was not at the kiosk, shown once when
	 * they identify again: the original action's time, that it was not recorded
	 * (they may then choose a fresh action), or that it cannot be checked here.
	 * Absent while unresolved.
	 */
	resolved?:
		| { outcome: "committed"; at: { instant: string; zone: string } }
		| { outcome: "not_recorded" }
		| { outcome: "conflict" };
};

export const KIOSK_UNCERTAIN_ACTION_STORAGE_KEY = "z8.kiosk.uncertainAction";

const PANEL_ACTIONS: readonly KioskAction[] = [
	"clock_in",
	"start_break",
	"clock_out",
	"resume_break",
	"end_day",
];

function isString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function parseResolution(value: unknown): KioskUncertainAction["resolved"] | null {
	if (typeof value !== "object" || value === null) return null;
	const resolution = value as Record<string, unknown>;
	if (resolution.outcome === "conflict") return { outcome: "conflict" };
	if (resolution.outcome === "not_recorded") return { outcome: "not_recorded" };
	const at = resolution.at as Record<string, unknown> | null | undefined;
	if (
		resolution.outcome === "committed" &&
		typeof at === "object" &&
		at !== null &&
		isString(at.instant) &&
		isString(at.zone)
	) {
		return { outcome: "committed", at: { instant: at.instant, zone: at.zone } };
	}
	return null;
}

function parseRecord(value: unknown): KioskUncertainAction | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const employee = record.employee as Record<string, unknown> | null | undefined;
	const resolved = record.resolved === undefined ? undefined : parseResolution(record.resolved);
	if (
		record.version !== 1 ||
		!isString(record.kioskId) ||
		!isString(record.operationId) ||
		typeof employee !== "object" ||
		employee === null ||
		!isString(employee.id) ||
		typeof employee.name !== "string" ||
		!PANEL_ACTIONS.includes(record.action as KioskAction) ||
		!(KIOSK_CLOCK_ACTIONS as readonly unknown[]).includes(record.request) ||
		(record.via !== undefined && record.via !== "badge") ||
		(record.vehicleUseLeftOut !== undefined && record.vehicleUseLeftOut !== true) ||
		resolved === null
	) {
		return null;
	}
	return {
		version: 1,
		kioskId: record.kioskId,
		operationId: record.operationId,
		employee: { id: employee.id, name: employee.name },
		action: record.action as KioskAction,
		request: record.request as KioskClockAction,
		...(record.via === "badge" ? { via: "badge" as const } : {}),
		...(record.vehicleUseLeftOut === true ? { vehicleUseLeftOut: true as const } : {}),
		...(resolved ? { resolved } : {}),
	};
}

/** Every well-formed stored record; anything malformed is dropped. */
function readAll(): KioskUncertainAction[] {
	let text: string | null;
	try {
		text = window.localStorage.getItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY);
	} catch {
		return [];
	}
	if (!text) return [];
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(value)) return [];
	return value.map(parseRecord).filter((record) => record !== null);
}

function writeAll(records: readonly KioskUncertainAction[]): void {
	try {
		if (records.length === 0) window.localStorage.removeItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY);
		else window.localStorage.setItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY, JSON.stringify(records));
	} catch {
		// Kept only in the page's state: a reload then cannot resolve it.
	}
}

/** Keeps the action before it is sent, or updates it (by operation) once Z8 answered. */
export function rememberUncertainAction(action: KioskUncertainAction): void {
	const others = readAll().filter((record) => record.operationId !== action.operationId);
	writeAll([...others, action]);
}

/**
 * The actions this kiosk is waiting to hear about. Records stored by another
 * kiosk (the device was paired again) are dropped: only their own kiosk could
 * resolve them.
 */
export function readUncertainActions(kioskId: string): KioskUncertainAction[] {
	const records = readAll();
	const own = records.filter((record) => record.kioskId === kioskId);
	if (own.length !== records.length) writeAll(own);
	return own;
}

/** Forgets one stored action, once its answer was shown (or it never ran). */
export function forgetUncertainAction(operationId: string): void {
	const records = readAll();
	const rest = records.filter((record) => record.operationId !== operationId);
	if (rest.length !== records.length) writeAll(rest);
}
