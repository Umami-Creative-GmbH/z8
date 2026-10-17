import type { KioskAction } from "@/lib/time-tracking/kiosk/kiosk-actions";
import type { KioskClockAction } from "@/lib/time-tracking/kiosk/protocol";

/** The clock request each kiosk panel action sends; "End day" clocks out. */
export const KIOSK_ACTION_REQUEST: Record<KioskAction, KioskClockAction> = {
	clock_in: "clock_in",
	start_break: "start_break",
	clock_out: "clock_out",
	resume_break: "resume_break",
	end_day: "clock_out",
};
