import type { Instant } from "@/lib/datetime/temporal-core";

/**
 * The detail of each Clocking refusal a kiosk may receive (#761). The kiosk is
 * an unauthenticated device, so only these named fields leave the server;
 * causes, requirements and anything a refusal adds later stay behind.
 */
const KIOSK_REFUSAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
	already_clocked_in: ["since"],
	admission_window: ["reason"],
	billing_required: ["reason"],
	holiday_blocked: ["holidayName"],
	under_review: ["review"],
};

function isInstant(value: unknown): value is Instant {
	return typeof value === "object" && value !== null && "epochNanoseconds" in value;
}

/** A Clocking refusal as the kiosk receives it: its code and the fields that code names. */
export function kioskRefusalDetail(
	failure: { code: string } & Record<string, unknown>,
): { code: string } & Record<string, unknown> {
	const detail: { code: string } & Record<string, unknown> = { code: failure.code };
	for (const field of KIOSK_REFUSAL_FIELDS[failure.code] ?? []) {
		const value = failure[field];
		if (value === undefined) continue;
		detail[field] = isInstant(value) ? value.toString() : value;
	}
	return detail;
}
