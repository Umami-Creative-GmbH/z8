"use client";

import { useEffect, useRef, useState } from "react";
import { authClient, useSession } from "@/lib/auth-client";

export type PlatformReadIdentity = {
	userId: string;
	sessionId: string;
	readId: string;
};

function matchesPlatformSession(
	data: ReturnType<typeof useSession>["data"],
	userId: string,
	sessionId: string,
) {
	return data?.user.id === userId && data.user.role === "admin" && data.session?.id === sessionId;
}

/** Controls display lifetime after the server has admitted a platform read. */
export function usePlatformReadStatus({ userId, sessionId, readId }: PlatformReadIdentity) {
	const session = useSession();
	const admitted = useRef(new Set<string>());
	const [retired, setRetired] = useState<ReadonlySet<string>>(() => new Set());
	const matches = matchesPlatformSession(session.data, userId, sessionId);
	const ready = matches && !session.isPending;
	useEffect(() => {
		const retire = () =>
			setRetired((previous) => (previous.has(readId) ? previous : new Set([...previous, readId])));
		if (ready) admitted.current.add(readId);
		if ((!session.isPending && !matches) || (session.isPending && admitted.current.has(readId)))
			retire();
		return authClient.$store.atoms.session.subscribe((value) => {
			const next = value.data;
			if (
				(next && !matchesPlatformSession(next, userId, sessionId)) ||
				(!next && !value.isPending) ||
				(value.isPending && admitted.current.has(readId))
			)
				retire();
		});
	}, [ready, matches, session.isPending, readId, userId, sessionId]);
	// Activity disconnects effects while hidden. Returning requires a new admitted read.
	useEffect(() => {
		const admittedReads = admitted.current;
		return () => {
			if (admittedReads.has(readId)) setRetired((previous) => new Set([...previous, readId]));
		};
	}, [readId]);
	if (ready && !retired.has(readId)) return "available";
	return session.isPending ? "pending" : "retired";
}
