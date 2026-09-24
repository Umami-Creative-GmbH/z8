/**
 * Preservation fence for old direct-route clock queue readers (#266).
 *
 * Deployed pre-preservation readers delete a queued row on some failure
 * statuses. This fence rewrites only failure responses to a status that the
 * identified reader retains; it never turns a failure into success and never
 * refuses a request that would otherwise succeed. Original error text is kept.
 *
 * - Pre-#267 browser service-worker sync (`public/lib/sync-service.js` at
 *   `66bbc7b5`) deletes on 400/409 and counts every other failure towards
 *   retry exhaustion. Only 401 stops processing without deleting or counting.
 *   It always sends the queued `organizationId`, which this route rejects.
 * - Browser extension readers (cohorts X1–X3, removed in `4722f938`) post with
 *   cookies from a `chrome-extension://` origin; X3 also sends a UUID `id` and
 *   `replay`. They delete on 2xx and 400 (X1 also on 401), keep the row on 409
 *   and have no age or exhaustion purge.
 *
 * The fence only stops these readers from deleting. It does not update or
 * disable them, and it cannot reach deletions that need no server response
 * (browser age cleanup, rows already at the retry limit).
 *
 * Retire or narrow this fence when the #266 inventory shows no remaining
 * pre-preservation reader, or when a new cookie client (for example #282)
 * adopts `id`/`replay`/`organizationId`: such clients are classified here.
 */
export type LegacyClockConsumer =
	| "legacy-browser-queue"
	| "legacy-extension-queue";

const BEARER_AUTHORIZATION = /^bearer\s/i;
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//i;

export function classifyLegacyClockConsumer(
	requestHeaders: Headers,
	body: unknown,
): LegacyClockConsumer | null {
	if (!body || typeof body !== "object") return null;
	if (BEARER_AUTHORIZATION.test(requestHeaders.get("authorization") ?? ""))
		return null;

	const fields = body as Record<string, unknown>;
	if (
		EXTENSION_ORIGIN.test(requestHeaders.get("origin") ?? "") ||
		fields.id !== undefined ||
		fields.replay !== undefined
	) {
		return "legacy-extension-queue";
	}
	if (
		fields.organizationId !== undefined &&
		fields.utcOffsetMinutes === undefined
	) {
		return "legacy-browser-queue";
	}
	return null;
}

const RETAINING_STATUS: Record<
	LegacyClockConsumer,
	(status: number) => number | null
> = {
	"legacy-browser-queue": () => 401,
	"legacy-extension-queue": (status) => (status === 400 ? 409 : null),
};

export async function fenceLegacyClockConsumerResponse(
	consumer: LegacyClockConsumer | null,
	response: Response,
): Promise<Response> {
	if (!consumer || response.ok) return response;
	const status = RETAINING_STATUS[consumer](response.status);
	if (status === null) return response;

	const original = (await response
		.clone()
		.json()
		.catch(() => ({}))) as { error?: unknown };
	const error =
		typeof original.error === "string"
			? original.error
			: `HTTP ${response.status}`;

	return Response.json({ error, hold: consumer }, { status });
}
