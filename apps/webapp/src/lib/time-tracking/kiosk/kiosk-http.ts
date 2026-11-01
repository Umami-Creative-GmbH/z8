import "server-only";

import type { z } from "zod";

/**
 * The kiosk endpoints' HTTP basics: every kiosk answer is uncached, and a body
 * that is no JSON or does not fit its schema reads as none.
 */
export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200) {
	return Response.json(body, { status, headers: NO_STORE });
}

/** The request's JSON body when it fits `schema`, else null. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		const parsed = schema.safeParse(await request.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
