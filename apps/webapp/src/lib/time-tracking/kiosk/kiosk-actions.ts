import type { KioskEmployeeState } from "./protocol";

/**
 * What an employee can press at a kiosk, online or offline (#862, #1292).
 * `end_day` is a clock-out while on a break: the day ends at the break's start.
 * Client-safe.
 */
export type KioskAction = "clock_in" | "start_break" | "clock_out" | "resume_break" | "end_day";

const ACTIONS_BY_STATUS: Record<KioskEmployeeState["status"], readonly KioskAction[]> = {
	clocked_out: ["clock_in"],
	clocked_in: ["start_break", "clock_out"],
	on_break: ["resume_break", "end_day"],
};

/** The actions an employee in this state can press, in the order the kiosk offers them. */
export function kioskActionsFor(state: Pick<KioskEmployeeState, "status">): readonly KioskAction[] {
	return ACTIONS_BY_STATUS[state.status];
}

/** Whether the action can follow from this state. */
export function allowedFrom(
	state: Pick<KioskEmployeeState, "status">,
	action: KioskAction,
): boolean {
	return kioskActionsFor(state).includes(action);
}
