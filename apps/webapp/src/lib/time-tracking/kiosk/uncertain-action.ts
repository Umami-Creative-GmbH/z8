import type { KioskAction } from "./kiosk-actions";
import { KIOSK_CLOCK_ACTIONS, type KioskClockAction } from "./protocol";

/**
 * The online kiosk action the device is waiting to hear about (#1363, spec
 * #889): what names the attempt, so that a lost reply, a reload or a remount
 * resolves the same operation instead of making a second one. Stored in
 * `localStorage` before the action is sent and removed once Z8 answered it.
 *
 * It holds no PIN, no badge and no command: nothing in it can run the action
 * again. Client-safe; storage that throws keeps nothing (the page's own state
 * still holds the turn until it is resolved).
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
	/** When the device sent it (UTC ISO), for support only. */
	submittedAt: string;
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

function parse(text: string | null): KioskUncertainAction | null {
	if (!text) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const employee = record.employee as Record<string, unknown> | null | undefined;
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
		!isString(record.submittedAt)
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
		submittedAt: record.submittedAt,
	};
}

/** Keeps the action before it is sent. */
export function rememberUncertainAction(action: KioskUncertainAction): void {
	try {
		window.localStorage.setItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY, JSON.stringify(action));
	} catch {
		// Kept only in the page's state: a reload then cannot resolve it.
	}
}

/**
 * The action this kiosk is waiting to hear about. One stored by another kiosk
 * (the device was paired again) is dropped: only its own kiosk could resolve it.
 */
export function readUncertainAction(kioskId: string): KioskUncertainAction | null {
	let text: string | null;
	try {
		text = window.localStorage.getItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY);
	} catch {
		return null;
	}
	const action = parse(text);
	if (text !== null && action?.kioskId !== kioskId) {
		forgetUncertainAction();
		return null;
	}
	return action;
}

/** Forgets the stored action; with an operation, only while it is still that one. */
export function forgetUncertainAction(operationId?: string): void {
	try {
		if (operationId !== undefined) {
			const stored = parse(window.localStorage.getItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY));
			if (stored && stored.operationId !== operationId) return;
		}
		window.localStorage.removeItem(KIOSK_UNCERTAIN_ACTION_STORAGE_KEY);
	} catch {
		// Nothing stored, nothing to forget.
	}
}
