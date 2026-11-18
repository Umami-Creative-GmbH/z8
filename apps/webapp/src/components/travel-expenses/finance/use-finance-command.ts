"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";

export interface FinanceSubmission {
	arrival: symbol;
}

/** Pending Better Auth refreshes may retain the same admitted session. */
export function useFinanceReadScope() {
	const session = useSession();
	const knownIdentity = session.data
		? `${session.data.user.id}:${session.data.session.activeOrganizationId ?? ""}`
		: null;
	const [arrival, setArrival] = useState(() => ({
		identity: knownIdentity,
		nonce: crypto.randomUUID(),
	}));
	const identity = knownIdentity ?? (session.isPending ? arrival.identity : "signed-out");
	let current = arrival;
	if (arrival.identity !== identity) {
		current = { identity, nonce: crypto.randomUUID() };
		setArrival(current);
	}
	const connected = useRef(false);
	useLayoutEffect(() => {
		if (connected.current) setArrival((previous) => ({ ...previous, nonce: crypto.randomUUID() }));
		connected.current = true;
	}, []);
	return `${identity ?? "checking"}:${current.nonce}`;
}

/** Client continuation lifetime only. Server actions still resolve live authority. */
export function useFinanceCommand(target: string, active = true) {
	const identity = useFinanceReadScope();
	const arrival = useRef<symbol | null>(null);
	const pending = useRef<FinanceSubmission | null>(null);
	const [busy, setBusy] = useState(false);
	useLayoutEffect(() => {
		arrival.current = active ? Symbol(`${identity}:${target}`) : null;
		pending.current = null;
		setBusy(false);
		return () => {
			arrival.current = null;
			pending.current = null;
		};
	}, [identity, target, active]);
	function isCurrent(submission: FinanceSubmission) {
		return pending.current === submission && arrival.current === submission.arrival;
	}
	return {
		busy,
		reserve() {
			if (!active || !arrival.current || pending.current) return null;
			const submission = { arrival: arrival.current };
			pending.current = submission;
			setBusy(true);
			return submission;
		},
		isCurrent,
		isPending: () => pending.current !== null,
		release(submission: FinanceSubmission) {
			if (!isCurrent(submission)) return;
			pending.current = null;
			setBusy(false);
		},
	};
}
