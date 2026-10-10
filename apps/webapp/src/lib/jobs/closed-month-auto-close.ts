import { db } from "@/db";
import {
	type AutomaticCloseRunResult,
	runAutomaticMonthClose,
} from "@/lib/time-tracking/closed-months/automatic-close";

export interface ClosedMonthAutoCloseJobResult extends AutomaticCloseRunResult {
	success: true;
}

/**
 * Closes the month before for every organization with automatic close on, once
 * its configured number of days has passed (#762). Hourly, so each
 * organization's day is reached soon after its local midnight; each
 * organization day is attempted once.
 */
export async function runClosedMonthAutoCloseJob(): Promise<ClosedMonthAutoCloseJobResult> {
	const result = await runAutomaticMonthClose(db);
	return { success: true, ...result };
}
