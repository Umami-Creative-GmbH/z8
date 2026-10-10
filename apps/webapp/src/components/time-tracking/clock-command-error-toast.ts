import { toast } from "sonner";
import { isClockConnectionRequired } from "@/lib/time-tracking/browser-clock-command";

/**
 * Shows a failed clock command as an error toast, except the refusal for needing a
 * connection in this organization (#845): nothing was saved, and `ClockConnectionNotice`
 * shows it inline instead.
 */
export function toastClockCommandError(
	result: { success: boolean; code?: unknown },
	...toastArgs: Parameters<typeof toast.error>
): void {
	if (isClockConnectionRequired(result)) return;
	toast.error(...toastArgs);
}
