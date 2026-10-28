import {
	parseWebClockStatus,
	WEB_CLOCK_STATUS_UNAVAILABLE,
	type WebClockStatus,
} from "./web-clock-status";

/** Current web state through its existing reader, outside the Server Action FIFO. */
export const WEB_CLOCK_STATUS_ROUTE = "/api/time-clock/status";
export async function getWebClockStatus(): Promise<WebClockStatus> {
	try {
		// Do not consume TanStack's AbortSignal: preserve the existing read lifetime.
		const response = await fetch(WEB_CLOCK_STATUS_ROUTE, {
			credentials: "same-origin",
			cache: "no-store",
		});
		if (
			response.status !== 200 ||
			response.headers
				.get("content-type")
				?.split(";")[0]
				.trim()
				.toLowerCase() !== "application/json"
		)
			throw Error();
		return parseWebClockStatus(await response.json());
	} catch {
		throw new Error(WEB_CLOCK_STATUS_UNAVAILABLE);
	}
}
