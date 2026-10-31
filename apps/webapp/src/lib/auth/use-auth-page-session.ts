"use client";

import { useQuery } from "@tanstack/react-query";
import { loadAuthPageClient } from "./load-auth-page-client";

async function fetchAuthPageSession() {
	const client = await loadAuthPageClient();
	const { data } = await client.getSession();
	return data ?? null;
}

/**
 * The current session for signed-out pages, read once through the lazily loaded
 * auth page client. Unlike `useSession` from `@/lib/auth-client`, it does not put
 * the app's Better Auth client (and its organization/admin plugins) into the page.
 * These pages navigate away after signing in or out, so a one-off read is enough.
 */
export function useAuthPageSession() {
	const { data, isPending } = useQuery({
		queryKey: ["auth-page-session"],
		queryFn: fetchAuthPageSession,
		staleTime: 0,
		gcTime: 0,
	});
	return { data: data ?? null, isPending };
}
