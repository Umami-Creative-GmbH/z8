"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { runWithCleanup } from "@/lib/run-with-cleanup";

const empty: ReadonlySet<string> = new Set();

function createReservations() {
	const commands = new Map<string, symbol>();
	const listeners = new Set<() => void>();
	let snapshot = empty;
	function notify() {
		snapshot = new Set(commands.keys());
		for (const listener of listeners) listener();
	}
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => snapshot,
		reserve(key: string) {
			if (commands.has(key)) return null;
			const command = Symbol();
			commands.set(key, command);
			notify();
			return () => {
				if (commands.get(key) !== command) return;
				commands.delete(key);
				notify();
			};
		},
	};
}

const reservations = new WeakMap<QueryClient, ReturnType<typeof createReservations>>();
function forClient(client: QueryClient) {
	let state = reservations.get(client);
	if (!state) {
		state = createReservations();
		reservations.set(client, state);
	}
	return state;
}
const serverSnapshot = () => empty;

/** Only pending command identities survive panel replacement; no document data is retained. */
export function useSickNoteUnlinkReservation(scope: {
	userId: string | null;
	organizationId: string | null;
}) {
	const state = forClient(useQueryClient());
	const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, serverSnapshot);
	const key = (documentId: string) =>
		JSON.stringify([scope.userId, scope.organizationId, documentId]);
	return {
		isPending: (documentId: string) => snapshot.has(key(documentId)),
		run(documentId: string, command: () => Promise<void>) {
			if (!scope.userId || !scope.organizationId) return Promise.resolve();
			const release = state.reserve(key(documentId));
			return release ? runWithCleanup(command, release) : Promise.resolve();
		},
	};
}
