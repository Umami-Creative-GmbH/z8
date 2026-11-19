"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "@/lib/auth-client";

export interface FinanceSubmission {
	arrival: symbol;
}

// A retired view cannot release an external command that is still unsettled.
const unsettledCommands = new Map<string, FinanceSubmission>();
const commandListeners = new Set<() => void>();

function subscribeCommands(listener: () => void) {
	commandListeners.add(listener);
	return () => {
		commandListeners.delete(listener);
	};
}

function notifyCommands() {
	for (const listener of commandListeners) listener();
}

function serverBusy() {
	return false;
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
	const session = useSession();
	const userId = session.data?.user.id;
	const organizationId = session.data?.session.activeOrganizationId;
	const key = JSON.stringify([userId ?? null, organizationId ?? null, target]);
	const ready = active && Boolean(userId && organizationId);
	const arrival = useRef<symbol | null>(null);
	const pending = useRef<FinanceSubmission | null>(null);
	const busy = useSyncExternalStore(
		subscribeCommands,
		() => unsettledCommands.has(key),
		serverBusy,
	);
	useLayoutEffect(() => {
		arrival.current = ready ? Symbol(`${identity}:${target}`) : null;
		pending.current = null;
		return () => {
			arrival.current = null;
			pending.current = null;
		};
	}, [identity, target, ready]);
	function isCurrent(submission: FinanceSubmission) {
		return pending.current === submission && arrival.current === submission.arrival;
	}
	return {
		busy,
		reserve() {
			if (!ready || !arrival.current || pending.current || unsettledCommands.has(key)) return null;
			const submission = { arrival: arrival.current };
			pending.current = submission;
			unsettledCommands.set(key, submission);
			notifyCommands();
			return submission;
		},
		isCurrent,
		isPending: () => unsettledCommands.has(key),
		release(submission: FinanceSubmission) {
			if (isCurrent(submission)) pending.current = null;
			if (unsettledCommands.get(key) === submission) {
				unsettledCommands.delete(key);
				notifyCommands();
			}
		},
	};
}
