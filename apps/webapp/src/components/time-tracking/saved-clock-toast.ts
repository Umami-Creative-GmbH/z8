import { toast } from "sonner";

type Translate = (key: string, defaultValue: string) => string;

/**
 * Shows a clock action that is saved on this device but not confirmed on the
 * server. Frozen commands (#279) are sent automatically; older captures wait for
 * review. Returns false for any other result so callers keep their own handling.
 */
export function showSavedClockToast(
	result: object,
	action: "clock_in" | "clock_out",
	t: Translate,
): boolean {
	if (!("queued" in result) || !result.queued) return false;
	const delivery = "delivery" in result ? result.delivery : undefined;
	if (delivery === "pending") {
		toast.info(
			action === "clock_in"
				? t(
						"timeTracking.clockInSavedForSending",
						"Clock-in saved on this device. It is sent automatically and is not confirmed yet.",
					)
				: t(
						"timeTracking.clockOutSavedForSending",
						"Clock-out saved on this device. It is sent automatically and is not confirmed yet.",
					),
		);
		return true;
	}
	if (delivery === "held") {
		toast.warning(
			action === "clock_in"
				? t(
						"timeTracking.clockInSavedHeld",
						"Clock-in saved on this device but not sent. Review saved records.",
					)
				: t(
						"timeTracking.clockOutSavedHeld",
						"Clock-out saved on this device but not sent. Review saved records.",
					),
		);
		return true;
	}
	toast.info(
		action === "clock_in"
			? t(
					"timeTracking.clockInSavedForReview",
					"Clock-in saved on this device for review; not confirmed on the server",
				)
			: t(
					"timeTracking.clockOutSavedForReview",
					"Clock-out saved on this device for review; not confirmed on the server",
				),
	);
	return true;
}
