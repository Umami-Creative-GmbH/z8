import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";
import { auth } from "@/lib/auth";

export type RequestSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Better Auth session for the current request.
 *
 * Runtime prefetches (`cacheComponents`) prerender with request data but must
 * not start I/O: the instrumented pool's `io()` rejects when the prerender
 * completes, and Better Auth would log that rejection, query parameters and
 * session token included, as INTERNAL_SERVER_ERROR. `connection()` hangs in
 * prerenders and resolves in requests, server actions and route handlers, so
 * the session query only starts for a real request.
 */
export async function getRequestSession(): Promise<RequestSession> {
	await connection();
	return auth.api.getSession({ headers: await headers() });
}
